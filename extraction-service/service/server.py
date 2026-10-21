"""Serviço HTTP de extração de campos em documentos empresariais.

Expõe endpoints REST para health check e extração de dados usando
motores de leitura OCR e a camada de regras (RuleExtractor).
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import sys
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# Garante que a raiz do serviço esteja no sys.path
_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import fitz  # PyMuPDF

from common import vocab

logger = logging.getLogger(__name__)

MAX_BODY_SIZE = 10 * 1024 * 1024  # 10 MB (10.485.760 bytes)

ENGINE_REGISTRY: dict[str, str] = {
    "tesseract": "extraction.engines.tesseract_engine:TesseractEngine",
}


def resolve_symbol(symbol_str: str) -> Any:
    """Resolve uma string de importação no formato 'modulo.submodulo:Classe' ou 'modulo.Classe'."""
    if symbol_str in ENGINE_REGISTRY:
        symbol_str = ENGINE_REGISTRY[symbol_str]

    if ":" in symbol_str:
        module_path, attr_name = symbol_str.split(":", 1)
    elif "." in symbol_str:
        module_path, attr_name = symbol_str.rsplit(".", 1)
    else:
        raise ValueError(f"Formato inválido de símbolo importável: '{symbol_str}'")

    mod = importlib.import_module(module_path)
    return getattr(mod, attr_name)


def detect_file_type(data: bytes) -> str | None:
    """Detecta o formato do arquivo exclusivamente pelos magic bytes."""
    if len(data) >= 4 and data.startswith(b"%PDF"):
        return "pdf"
    if len(data) >= 8 and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 3 and data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    return None


def convert_image_to_pdf_bytes(image_bytes: bytes, ext: str) -> bytes:
    """Converte imagem PNG ou JPEG em um documento PDF de página única via PyMuPDF."""
    doc = fitz.open(stream=image_bytes, filetype=ext)
    pdf_bytes = doc.convert_to_pdf()
    doc.close()
    return pdf_bytes


class ExtractionServer(ThreadingHTTPServer):
    """Servidor HTTP multithread com motor, extrator e lock compartilhados."""

    def __init__(
        self,
        server_address: tuple[str, int],
        RequestHandlerClass: type[BaseHTTPRequestHandler],
        engine: Any,
        extractor: Any,
    ) -> None:
        super().__init__(server_address, RequestHandlerClass)
        self.engine = engine
        self.extractor = extractor
        self.lock = threading.Lock()


class ExtractionHandler(BaseHTTPRequestHandler):
    """Manipulador de requisições do serviço de extração."""

    server: ExtractionServer

    def log_message(self, format: str, *args: Any) -> None:
        logger.debug("%s - - [%s] %s", self.address_string(), self.log_date_time_string(), format % args)

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/health":
            engine_name = getattr(self.server.engine, "name", "unknown")
            engine_version = getattr(self.server.engine, "engine_version", "unknown")
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "engine": engine_name,
                    "engine_version": engine_version,
                },
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint não encontrado"})

    def do_POST(self) -> None:
        if self.path != "/extract":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint não encontrado"})
            return

        # Validação de tamanho pelo Content-Length e leitura do corpo
        content_length_str = self.headers.get("Content-Length")
        content_length = int(content_length_str) if (content_length_str and content_length_str.isdigit()) else None

        if content_length is not None and content_length > MAX_BODY_SIZE:
            # Drena os dados restantes para permitir que o cliente receba a resposta HTTP sem BrokenPipe
            remaining = content_length
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "Arquivo excede o limite máximo de 10 MB."},
            )
            return

        # Leitura do corpo quando dentro do tamanho ou sem Content-Length informado
        to_read = content_length if content_length is not None else MAX_BODY_SIZE + 1
        body = self.rfile.read(to_read)

        if len(body) > MAX_BODY_SIZE:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "Arquivo excede o limite máximo de 10 MB."},
            )
            return

        # Detecção de tipo pelos magic bytes
        file_type = detect_file_type(body)
        if file_type is None:
            self._send_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                {"error": "Formato de arquivo não suportado. Envie PDF, PNG ou JPEG."},
            )
            return

        temp_pdf_path: str | None = None
        try:
            # Converte imagens para PDF ou usa o PDF original
            if file_type in ("png", "jpeg"):
                pdf_data = convert_image_to_pdf_bytes(body, file_type)
            else:
                pdf_data = body

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                temp_pdf_path = tmp.name
                tmp.write(pdf_data)

            # Execução sincronizada (lock) para evitar saturação de CPU/RAM em leituras simultâneas
            with self.server.lock:
                read_result = self.server.engine.read(Path(temp_pdf_path))
                raw_fields = self.server.extractor.extract(read_result)

            # Mapeamento para o contrato DocsObs
            field_map = {
                "issueDate": raw_fields.get("data_emissao"),
                "expirationDate": raw_fields.get("data_vencimento"),
                "issuingBody": raw_fields.get("orgao_emissor"),
            }

            formatted_fields: dict[str, dict[str, Any]] = {}
            for target_field, pred in field_map.items():
                if pred is None or pred.value is None or pred.value == vocab.ABSENT:
                    formatted_fields[target_field] = {
                        "value": None,
                        "confidence": 0.0,
                    }
                else:
                    val = pred.value
                    if target_field == "issuingBody":
                        # Garante nome canônico caso não esteja já normalizado
                        for o in vocab.ORGAOS:
                            if val == o.canonical or val in o.aliases:
                                val = o.canonical
                                break
                    formatted_fields[target_field] = {
                        "value": val,
                        "confidence": round(float(pred.confidence), 4),
                    }

            self._send_json(
                HTTPStatus.OK,
                {
                    "engine": read_result.engine,
                    "engine_version": read_result.engine_version,
                    "elapsed_s": round(float(read_result.elapsed_s), 2),
                    "fields": formatted_fields,
                },
            )

        except Exception as e:
            logger.exception("Erro interno ao processar documento")
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Erro interno ao processar extração: {str(e)}"},
            )
        finally:
            if temp_pdf_path and os.path.exists(temp_pdf_path):
                try:
                    os.unlink(temp_pdf_path)
                except OSError:
                    pass


def create_server(
    host: str = "0.0.0.0",
    port: int = 8000,
    engine_name_or_symbol: str | None = None,
    extractor_symbol: str = "extraction.rules:RuleExtractor",
) -> ExtractionServer:
    """Instancia o motor, o extrator e o servidor HTTP."""
    selected_engine = engine_name_or_symbol or os.environ.get("EXTRACTION_ENGINE", "tesseract")
    logger.info("Carregando motor de leitura: %s", selected_engine)
    engine_cls = resolve_symbol(selected_engine)
    engine = engine_cls()

    logger.info("Carregando extrator: %s", extractor_symbol)
    extractor_cls = resolve_symbol(extractor_symbol)
    extractor = extractor_cls()

    server = ExtractionServer(
        (host, port),
        ExtractionHandler,
        engine=engine,
        extractor=extractor,
    )
    return server


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="DocsObs Python Extraction Service")
    parser.add_argument("--host", default="0.0.0.0", help="Host para bind (padrão 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Porta para bind (padrão 8000)")
    parser.add_argument(
        "--engine",
        default=os.environ.get("EXTRACTION_ENGINE", "tesseract"),
        help="Motor de OCR (tesseract ou modulo:Classe)",
    )
    args = parser.parse_args()

    server = create_server(host=args.host, port=args.port, engine_name_or_symbol=args.engine)
    logger.info("Serviço de extração ouvindo em http://%s:%d", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Encerrando servidor...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
