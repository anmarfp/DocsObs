"""Testes do motor de leitura Tesseract. PDFs gerados no próprio teste."""

from __future__ import annotations

import re
from pathlib import Path

import fitz
import psutil
import pytest

from extraction.engines.tesseract_engine import TesseractEngine
from extraction.interface import ReadResult

LINES = [
    "Certidão emitida em 15/03/2026",
    "Válida até 11/09/2026",
    "Secretaria Especial da Receita Federal do Brasil",
]


def _draw_lines(page: fitz.Page, lines: list[str], y0: float = 100.0) -> None:
    for i, text in enumerate(lines):
        page.insert_text((72, y0 + i * 60), text, fontname="helv", fontsize=18)


@pytest.fixture(scope="module")
def engine() -> TesseractEngine:
    return TesseractEngine()


@pytest.fixture(scope="module")
def text_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("tess") / "texto.pdf"
    with fitz.open() as doc:
        _draw_lines(doc.new_page(width=595, height=842), LINES)
        doc.save(path)
    return path


@pytest.fixture(scope="module")
def image_only_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Texto desenhado como imagem; camada de texto invisível diz outra coisa."""
    base = tmp_path_factory.mktemp("tess_img")
    with fitz.open() as src:
        _draw_lines(src.new_page(width=595, height=842), ["Emitida em 02/02/2024", "Validade 03/03/2025"])
        png = src[0].get_pixmap(dpi=200).tobytes("png")
    path = base / "imagem.pdf"
    with fitz.open() as doc:
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=png)
        # Camada de texto invisível (render_mode=3) com conteúdo diferente.
        page.insert_text((72, 100), "Emitida em 09/09/1999 FALSO", fontname="helv", fontsize=18, render_mode=3)
        page.insert_text((72, 160), "Validade 08/08/1998 FALSO", fontname="helv", fontsize=18, render_mode=3)
        assert "FALSO" in page.get_text()
        doc.save(path)
    return path


@pytest.fixture(scope="module")
def result(engine: TesseractEngine, text_pdf: Path) -> ReadResult:
    return engine.read(text_pdf)


def test_returns_read_result_with_engine_name(engine: TesseractEngine, result: ReadResult) -> None:
    assert isinstance(result, ReadResult)
    assert result.engine == engine.name == "tesseract"
    assert "tesseract" in result.engine_version and "psm=3" in result.engine_version
    assert "oem=1" in result.engine_version and "lang=por" in result.engine_version
    assert result.lines


def test_lines_in_reading_order(result: ReadResult) -> None:
    y0s = [line.bbox[1] for line in result.lines]
    assert y0s == sorted(y0s)
    texts = [line.text for line in result.lines]
    idx = [
        next(i for i, t in enumerate(texts) if key in t)
        for key in ("15/03/2026", "11/09/2026", "Receita")
    ]
    assert idx == sorted(idx)


def test_bbox_and_confidence_normalized(result: ReadResult) -> None:
    for line in result.lines:
        x0, y0, x1, y1 = line.bbox
        assert 0.0 <= x0 < x1 <= 1.0
        assert 0.0 <= y0 < y1 <= 1.0
        assert 0.0 <= line.confidence <= 1.0
        assert line.text == line.text.strip() and line.text
        assert line.page == 0


def test_dates_recognized(result: ReadResult) -> None:
    text = result.full_text()
    assert "15/03/2026" in text
    assert "11/09/2026" in text
    assert re.search(r"emitida", text, re.IGNORECASE)
    assert re.search(r"Receita", text)


def test_metrics_positive(result: ReadResult) -> None:
    assert result.elapsed_s > 0
    assert result.peak_rss_mb > 0


def test_peak_rss_includes_child_process(engine: TesseractEngine, text_pdf: Path) -> None:
    # O Tesseract roda como processo filho: o pico medido (processo + descendentes)
    # tem de superar o RSS do processo Python sozinho, medido logo após a leitura.
    res = engine.read(text_pdf)
    python_only_mb = psutil.Process().memory_info().rss / (1024.0 * 1024.0)
    assert res.peak_rss_mb > python_only_mb


def test_deterministic(engine: TesseractEngine, text_pdf: Path, result: ReadResult) -> None:
    again = engine.read(text_pdf)
    assert again.lines == result.lines


def test_ignores_pdf_text_layer(engine: TesseractEngine, image_only_pdf: Path) -> None:
    res = engine.read(image_only_pdf)
    text = res.full_text()
    assert "02/02/2024" in text
    assert "03/03/2025" in text
    assert "FALSO" not in text
    assert "1999" not in text and "1998" not in text
