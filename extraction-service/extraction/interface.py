"""Interfaces do serviço de extração de documentos.

Os motores de OCR implementam `ReadingEngine`, produzindo um `ReadResult`
padronizado sobre o qual a camada de regras (`FieldExtractor`) extrai os
campos estruturados.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class Line:
    """Uma linha de texto reconhecida pelo motor de leitura."""

    text: str
    # (x0, y0, x1, y1) normalizados para 0..1 em relação à página.
    bbox: tuple[float, float, float, float]
    # Confiança do motor para a linha, normalizada para 0..1.
    confidence: float
    page: int = 0


@dataclass(frozen=True)
class ReadResult:
    """Saída de um motor de leitura para um documento inteiro."""

    engine: str
    engine_version: str
    # Linhas em ordem de leitura (página, depois de cima para baixo, esquerda
    # para a direita).
    lines: tuple[Line, ...]
    # Tempo de parede da leitura (rasterização + OCR), em segundos.
    elapsed_s: float
    # Pico de memória residente do processo + subprocessos durante a leitura,
    # em MB, medido com `extraction.measure.PeakRssSampler` (obrigatório).
    peak_rss_mb: float

    def full_text(self) -> str:
        return "\n".join(line.text for line in self.lines)


class ReadingEngine(Protocol):
    """Protocolo genérico para motores de leitura de documentos (OCR)."""

    name: str

    def read(self, pdf_path: Path, dpi: int = 300) -> ReadResult:
        """Rasteriza todas as páginas do PDF com `extraction.raster.rasterize_pdf`
        e aplica OCR. Nunca usa a camada de texto embutida do PDF."""
        ...


@dataclass(frozen=True)
class FieldPrediction:
    """Predição para um campo.

    value:
      - data_emissao / data_vencimento: "AAAA-MM-DD" ou vocab.ABSENT;
      - orgao_emissor: nome canônico de vocab.CANONICAL_ORGAOS ou vocab.ABSENT;
      - None quando a regra não encontrou o campo (não é o mesmo que ABSENT).
    """

    value: str | None
    # Confiança da predição em 0..1 (combina confiança do OCR e força da regra).
    confidence: float
    # True quando a data foi calculada (ex.: "válida por 180 dias").
    derived: bool = False
    # Trecho do texto lido que sustentou a predição.
    evidence: str | None = None
    # Identificador da regra que produziu a predição.
    rule: str | None = None


class FieldExtractor(Protocol):
    """Protocolo para a camada de extração de campos por regras."""

    def extract(self, read: ReadResult) -> dict[str, FieldPrediction]:
        """Retorna uma predição para cada campo de vocab.FIELDS."""
        ...


@dataclass(frozen=True)
class ExtractionResult:
    doc_id: str
    engine: str
    fields: dict[str, FieldPrediction]
    read: ReadResult
    extra: dict[str, object] = field(default_factory=dict)
