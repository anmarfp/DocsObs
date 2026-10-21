"""Testes do serviço HTTP de extração de documentos (DocsObs).

Testa endpoints /health e /extract com motor de teste,
valida detecção de magic bytes, limites de payload, mapeamento de campos
e tratamento de erros.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
import pytest

from common import vocab
from extraction.interface import Line, ReadResult
from service.server import create_server


class MockReadingEngine:
    """Motor falso para testes rápidos sem carregar o Tesseract."""

    name = "mock_test_engine"
    engine_version = "0.1.0-mock"

    def read(self, pdf_path: Path, dpi: int = 300) -> ReadResult:
        # Garante que o arquivo temporário existe e é um PDF válido
        assert pdf_path.exists(), f"Arquivo temporário não encontrado: {pdf_path}"
        with fitz.open(pdf_path) as doc:
            assert len(doc) >= 1

        lines = (
            Line(
                text="Receita Federal do Brasil",
                bbox=(0.1, 0.05, 0.8, 0.08),
                confidence=0.92,
                page=0,
            ),
            Line(
                text="Emitida em 15/03/2026",
                bbox=(0.1, 0.12, 0.5, 0.15),
                confidence=0.95,
                page=0,
            ),
            Line(
                text="Validade indeterminada",
                bbox=(0.1, 0.20, 0.6, 0.23),
                confidence=0.88,
                page=0,
            ),
        )
        return ReadResult(
            engine=self.name,
            engine_version=self.engine_version,
            lines=lines,
            elapsed_s=0.15,
            peak_rss_mb=42.0,
        )


class ErrorReadingEngine:
    """Motor que sempre falha para testar retorno 500 e isolamento de falhas."""

    name = "error_test_engine"
    engine_version = "0.0.1-err"

    def read(self, pdf_path: Path, dpi: int = 300) -> ReadResult:
        raise RuntimeError("Simulação de falha catastrófica no motor de OCR")


@pytest.fixture(scope="module")
def server_address():
    """Sobe o servidor HTTP com MockReadingEngine em porta aleatória."""
    server = create_server(
        host="127.0.0.1",
        port=0,
        engine_name_or_symbol="tests.test_service:MockReadingEngine",
    )
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{port}"

    server.shutdown()
    server.server_close()


def make_test_pdf() -> bytes:
    """Cria um PDF mínimo válido em memória usando PyMuPDF."""
    doc = fitz.open()
    page = doc.new_page(width=300, height=400)
    page.insert_text((50, 100), "Documento de Teste")
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def make_test_png() -> bytes:
    """Cria um PNG mínimo válido em memória usando PyMuPDF."""
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 100), 0)
    png_bytes = pix.tobytes("png")
    return png_bytes


def test_health_check(server_address: str):
    """GET /health retorna 200 com status ok e identificação do motor."""
    url = f"{server_address}/health"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        assert "application/json" in res.headers.get("Content-Type", "")
        data = json.loads(res.read().decode("utf-8"))
        assert data["status"] == "ok"
        assert data["engine"] == "mock_test_engine"
        assert data["engine_version"] == "0.1.0-mock"


def test_extract_pdf_and_mapping(server_address: str):
    """POST /extract com PDF válido mapeia datas e converte ABSENT em null."""
    url = f"{server_address}/extract"
    pdf_bytes = make_test_pdf()
    req = urllib.request.Request(
        url,
        data=pdf_bytes,
        headers={"Content-Type": "application/pdf"},
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        data = json.loads(res.read().decode("utf-8"))
        assert data["engine"] == "mock_test_engine"
        assert data["engine_version"] == "0.1.0-mock"
        assert "elapsed_s" in data

        fields = data["fields"]
        assert fields["issueDate"]["value"] == "2026-03-15"
        assert fields["issueDate"]["confidence"] > 0.0

        # Validade indeterminada (ABSENT) vira value: null e confidence: 0.0
        assert fields["expirationDate"]["value"] is None
        assert fields["expirationDate"]["confidence"] == 0.0

        # Órgão canônico
        assert (
            fields["issuingBody"]["value"]
            == "Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional"
        )
        assert fields["issuingBody"]["confidence"] > 0.0


def test_extract_png(server_address: str):
    """POST /extract aceita imagem PNG, converte em PDF e executa OCR."""
    url = f"{server_address}/extract"
    png_bytes = make_test_png()
    req = urllib.request.Request(
        url,
        data=png_bytes,
        headers={"Content-Type": "image/png"},
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        data = json.loads(res.read().decode("utf-8"))
        assert data["fields"]["issueDate"]["value"] == "2026-03-15"


def test_unsupported_media_type_415(server_address: str):
    """POST /extract rejeita arquivo com magic bytes desconhecidos (ex.: texto puro)."""
    url = f"{server_address}/extract"
    raw_text = b"Ola mundo, isto nao e um PDF nem uma imagem valida."
    req = urllib.request.Request(
        url,
        data=raw_text,
        headers={"Content-Type": "application/pdf"},  # Header mente, magic bytes desmascaram
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req)
    assert exc_info.value.code == 415


def test_payload_too_large_413(server_address: str):
    """POST /extract rejeita corpo maior que 10 MB."""
    url = f"{server_address}/extract"
    big_body = b"%PDF" + b"0" * (10 * 1024 * 1024 + 10)
    req = urllib.request.Request(
        url,
        data=big_body,
        headers={"Content-Type": "application/pdf"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req)
    assert exc_info.value.code == 413


def test_engine_error_500_resilience():
    """Erro interno no motor responde 500 sem derrubar o servidor."""
    server = create_server(
        host="127.0.0.1",
        port=0,
        engine_name_or_symbol="tests.test_service:ErrorReadingEngine",
    )
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = f"http://127.0.0.1:{port}/extract"
    pdf_bytes = make_test_pdf()
    req = urllib.request.Request(
        url,
        data=pdf_bytes,
        headers={"Content-Type": "application/pdf"},
        method="POST",
    )

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req)
    assert exc_info.value.code == 500

    # Servidor continua de pé para responder ao /health
    health_req = urllib.request.Request(f"http://127.0.0.1:{port}/health", method="GET")
    with urllib.request.urlopen(health_req) as res:
        assert res.status == 200

    server.shutdown()
    server.server_close()
