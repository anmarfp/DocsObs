"""Rasterização de páginas de PDF em imagens RGB para leitura por OCR."""

from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF
import numpy as np


def rasterize_pdf(pdf_path: Path, dpi: int = 300) -> list[np.ndarray]:
    """Renderiza cada página do PDF como imagem RGB (H x W x 3, uint8).

    A camada de texto embutida é ignorada: o resultado é só a imagem.
    """
    images: list[np.ndarray] = []
    zoom = dpi / 72.0
    with fitz.open(pdf_path) as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            images.append(img.copy())
    return images
