"""Motor de leitura de documentos baseado no Tesseract OCR."""

from __future__ import annotations

import tempfile
import time
from importlib import metadata
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import pytesseract
from pytesseract import Output

from extraction.interface import Line, ReadResult
from extraction.measure import PeakRssSampler
from extraction.raster import rasterize_pdf

_LANG = "por"
_OEM = 1
_PSM = 3
_CONFIG = f"--oem {_OEM} --psm {_PSM}"


class TesseractEngine:
    """Motor de OCR Tesseract 5 (LSTM, `por`) sobre as imagens de `rasterize_pdf`.

    Características:
    - Nenhum pré-processamento de imagem (sem binarização, sem deskew); a imagem
      RGB de `rasterize_pdf` é passada direto ao Tesseract. A camada de texto do
      PDF nunca é lida.
    - `--oem 1 --psm 3`: motor LSTM e segmentação automática de página.
    - Linhas: palavras agrupadas por (block_num, par_num, line_num); texto =
      palavras unidas por espaço; bbox = união das caixas das palavras;
      confiança = média do `conf` das palavras / 100 (palavras vazias ou com
      conf == -1 são ignoradas).

    Aquecimento (warm-up): o Tesseract roda como subprocesso e não mantém um
    objeto de modelo em memória, mas a primeira chamada paga custos de partida
    (descoberta do binário, versão, carga de `por.traineddata` pelo SO). Na
    primeira `read`, ANTES de iniciar o cronômetro e o amostrador de memória, é
    feita a rasterização (300 dpi) e o OCR de uma página sintética com texto;
    esse tempo NÃO entra em `elapsed_s`. O warm-up ocorre uma única vez por
    instância (lazy), nunca por página.

    Medições: `elapsed_s` cobre rasterização + OCR; `peak_rss_mb` é o pico de RSS
    do processo atual SOMADO ao de todos os seus subprocessos (inclui o processo
    filho do Tesseract), amostrado a cada 50 ms (incluindo a amostra inicial) pelo
    `PeakRssSampler` de `extraction.measure`.
    """

    name = "tesseract"

    def __init__(self) -> None:
        self._warmed_up = False
        self._engine_version: str | None = None

    @property
    def engine_version(self) -> str:
        if self._engine_version is None:
            self._engine_version = (
                f"tesseract {pytesseract.get_tesseract_version()} / "
                f"pytesseract {metadata.version('pytesseract')} / "
                f"lang={_LANG} / oem={_OEM} / psm={_PSM}"
            )
        return self._engine_version

    def _warm_up(self) -> None:
        if self._warmed_up:
            return
        # Página A4 sintética com texto, rasterizada a 300 dpi pelo mesmo caminho
        # de `read`, para que os custos de primeira chamada (PyMuPDF, binário e
        # modelo do Tesseract) não vazem para o `elapsed_s` medido.
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "warmup.pdf"
            with fitz.open() as doc:
                page = doc.new_page(width=595, height=842)
                for i in range(5):
                    page.insert_text((72, 100 + i * 40), "Certidao emitida em 01/01/2026", fontsize=14)
                doc.save(pdf_path)
            for image in rasterize_pdf(pdf_path, 300):
                pytesseract.image_to_data(image, lang=_LANG, config=_CONFIG, output_type=Output.DICT)
        _ = self.engine_version
        self._warmed_up = True

    def read(self, pdf_path: Path, dpi: int = 300) -> ReadResult:
        self._warm_up()  # fora do cronômetro e do amostrador de memória

        sampler = PeakRssSampler()
        sampler.start()
        start = time.perf_counter()
        try:
            images = rasterize_pdf(Path(pdf_path), dpi)
            lines: list[Line] = []
            for page_idx, image in enumerate(images):
                lines.extend(self._read_page(image, page_idx))
            elapsed_s = time.perf_counter() - start
        finally:
            peak_rss_mb = sampler.stop()

        return ReadResult(
            engine=self.name,
            engine_version=self.engine_version,
            lines=tuple(lines),
            elapsed_s=elapsed_s,
            peak_rss_mb=peak_rss_mb,
        )

    def _read_page(self, image: np.ndarray, page_idx: int) -> list[Line]:
        height, width = image.shape[:2]
        data = pytesseract.image_to_data(
            image, lang=_LANG, config=_CONFIG, output_type=Output.DICT
        )

        grouped: dict[tuple[int, int, int], list[tuple[str, float, int, int, int, int]]] = {}
        for i in range(len(data["text"])):
            text = str(data["text"][i]).strip()
            conf = float(data["conf"][i])
            if not text or conf == -1:
                continue
            key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
            left, top = int(data["left"][i]), int(data["top"][i])
            grouped.setdefault(key, []).append(
                (text, conf, left, top, left + int(data["width"][i]), top + int(data["height"][i]))
            )

        page_lines: list[Line] = []
        for words in grouped.values():
            text = " ".join(w[0] for w in words).strip()
            if not text:
                continue
            x0 = min(w[2] for w in words) / width
            y0 = min(w[3] for w in words) / height
            x1 = max(w[4] for w in words) / width
            y1 = max(w[5] for w in words) / height
            confidence = sum(w[1] for w in words) / len(words) / 100.0
            page_lines.append(
                Line(
                    text=text,
                    bbox=(_clamp(x0), _clamp(y0), _clamp(x1), _clamp(y1)),
                    confidence=_clamp(confidence),
                    page=page_idx,
                )
            )
        return _reading_order(page_lines)


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _reading_order(lines: list[Line]) -> list[Line]:
    """Ordena de cima para baixo e da esquerda para a direita.

    Linhas cujos centros verticais diferem em menos da metade da altura da linha
    (âncora da linha de varredura) são tratadas como a mesma linha visual e
    ordenadas por x0.
    """
    ordered = sorted(lines, key=lambda ln: (ln.bbox[1], ln.bbox[0]))
    rows: list[list[Line]] = []
    anchor_center = anchor_height = 0.0
    for line in ordered:
        center = (line.bbox[1] + line.bbox[3]) / 2.0
        if rows and abs(center - anchor_center) < 0.5 * anchor_height:
            rows[-1].append(line)
            continue
        rows.append([line])
        anchor_center = center
        anchor_height = line.bbox[3] - line.bbox[1]
    return [ln for row in rows for ln in sorted(row, key=lambda ln: ln.bbox[0])]
