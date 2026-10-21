"""Módulo de parsing e manipulação de datas para extração com tolerância a OCR.

Este módulo implementa:
1. Normalização e correção de caracteres comuns confundidos por OCR dentro de tokens de data:
   O/o -> 0, I/l/| -> 1, S/s -> 5, B -> 8, Z/z -> 2.
2. Reconhecimento de datas numéricas (dd/mm/aaaa, dd.mm.aaaa, dd-mm-aaaa, d/m/aaaa).
3. Reconhecimento de datas por extenso em português (ex.: 15 de março de 2026, 15 de marco de 2026),
   com correspondência fuzzy para nomes de meses tolerando ruídos de OCR (rapidfuzz ratio >= 80).
4. Rejeição de datas impossíveis via datetime.date (ex.: 31/02/2026).
5. Aritmética de calendário para prazos derivados (dias, meses, anos).
"""

from __future__ import annotations

import calendar
import datetime
import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz import fuzz

# Mapeamento estrito de substituições de OCR aplicadas APENAS dentro de tokens numéricos de data.
CONFUSION_MAP: dict[str, str] = {
    "O": "0",
    "o": "0",
    "I": "1",
    "l": "1",
    "|": "1",
    "S": "5",
    "s": "5",
    "B": "8",
    "Z": "2",
    "z": "2",
}

# Nomes de meses em português e variações canônicas.
PORTUGUESE_MONTHS: dict[int, tuple[str, ...]] = {
    1: ("janeiro",),
    2: ("fevereiro",),
    3: ("março", "marco"),
    4: ("abril",),
    5: ("maio",),
    6: ("junho",),
    7: ("julho",),
    8: ("agosto",),
    9: ("setembro",),
    10: ("outubro",),
    11: ("novembro",),
    12: ("dezembro",),
}


def strip_accents(text: str) -> str:
    """Remove diacríticos e acentos preservando caracteres base ASCII."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def correct_digits(token: str) -> tuple[str, bool]:
    """Substitui caracteres de confusão de OCR por dígitos.

    Retorna o token corrigido e uma flag indicando se alguma correção foi necessária.
    Se o token resultante contiver caracteres não numéricos, retorna (token, False).
    """
    corrected_chars: list[str] = []
    was_corrected = False

    for char in token:
        if char in CONFUSION_MAP:
            corrected_chars.append(CONFUSION_MAP[char])
            was_corrected = True
        else:
            corrected_chars.append(char)

    candidate = "".join(corrected_chars)
    if candidate.isdigit():
        return candidate, was_corrected
    return token, False


def match_month_name(token: str) -> tuple[int | None, bool]:
    """Associa um token ao mês correspondente em português via correspondência exata ou fuzzy.

    Tolerante a ruído de OCR como 'rnarço' -> 'março' e erros de digitação (ratio >= 80).
    Retorna (número_do_mês, foi_corrigido).
    """
    tok_clean = strip_accents(token).lower()
    tok_rn_sub = tok_clean.replace("rn", "m")  # Ligatura clássica de OCR (rn -> m)

    best_month: int | None = None
    best_score = 0.0
    was_corrected = False

    for month_num, names in PORTUGUESE_MONTHS.items():
        for name in names:
            name_clean = strip_accents(name).lower()
            s1 = fuzz.ratio(tok_clean, name_clean)
            s2 = fuzz.ratio(tok_rn_sub, name_clean)
            score = max(s1, s2)

            if score > best_score:
                best_score = score
                best_month = month_num
                # Houve correção se não foi correspondência idêntica com o nome base
                was_corrected = (s1 < 100.0)

    if best_score >= 80.0 and best_month is not None:
        return best_month, was_corrected
    return None, False


@dataclass(frozen=True)
class ParsedDate:
    """Representação de uma data encontrada em uma linha de texto."""

    iso: str  # Formato "AAAA-MM-DD"
    date: datetime.date
    raw_text: str
    start_char: int
    end_char: int
    corrected: bool


# Regex para datas numéricas: dd/mm/aaaa, dd.mm.aaaa, dd-mm-aaaa, aceitando 1 ou 2 dígitos no dia/mês.
# Usa lookbehind/lookahead para evitar capturar pedaços de CPF, CNPJ ou códigos com mais dígitos.
NUMERIC_DATE_RE = re.compile(
    r"(?<![\w\/\.\-])([0-9OolISsBZz|]{1,2})[\/\.\-]([0-9OolISsBZz|]{1,2})[\/\.\-]([0-9OolISsBZz|]{4})(?![\w\/\.\-])"
)

# Regex para datas por extenso: '15 de março de 2026', '15 de rnarço de 2O26', '1 de maio de 2026'.
WRITTEN_DATE_RE = re.compile(
    r"(?<!\w)([0-9OolISsBZz|]{1,2})\s+(?:de\s+)?([A-Za-zçÇáéíóúÁÉÍÓÚ]{3,12})\s+(?:de\s+)?([0-9OolISsBZz|]{4})(?!\w)",
    re.IGNORECASE,
)


def find_dates_in_text(text: str) -> list[ParsedDate]:
    """Localiza e valida todas as datas presentes em uma string de texto.

    Rejeita datas impossíveis (ex.: 31/02/2026).
    Retorna lista ordenada pela posição do caractere inicial no texto.
    """
    found: list[ParsedDate] = []

    # 1. Datas numéricas
    for match in NUMERIC_DATE_RE.finditer(text):
        day_raw, month_raw, year_raw = match.groups()
        day_str, day_corr = correct_digits(day_raw)
        month_str, month_corr = correct_digits(month_raw)
        year_str, year_corr = correct_digits(year_raw)

        if not (day_str.isdigit() and month_str.isdigit() and year_str.isdigit()):
            continue

        day, month, year = int(day_str), int(month_str), int(year_str)
        if not (1900 <= year <= 2100):
            continue

        try:
            d = datetime.date(year, month, day)
        except ValueError:
            # Rejeita datas impossíveis como 31/02/2026
            continue

        found.append(
            ParsedDate(
                iso=d.isoformat(),
                date=d,
                raw_text=match.group(0),
                start_char=match.start(),
                end_char=match.end(),
                corrected=day_corr or month_corr or year_corr,
            )
        )

    # 2. Datas por extenso
    for match in WRITTEN_DATE_RE.finditer(text):
        day_raw, month_raw, year_raw = match.groups()
        day_str, day_corr = correct_digits(day_raw)
        month_num, month_corr = match_month_name(month_raw)
        year_str, year_corr = correct_digits(year_raw)

        if month_num is None or not (day_str.isdigit() and year_str.isdigit()):
            continue

        day, month, year = int(day_str), month_num, int(year_str)
        if not (1900 <= year <= 2100):
            continue

        try:
            d = datetime.date(year, month, day)
        except ValueError:
            continue

        found.append(
            ParsedDate(
                iso=d.isoformat(),
                date=d,
                raw_text=match.group(0),
                start_char=match.start(),
                end_char=match.end(),
                corrected=day_corr or month_corr or year_corr,
            )
        )

    # Ordena por início do span
    found.sort(key=lambda p: (p.start_char, -(p.end_char - p.start_char)))

    # Desduplica sobreposições (mantém a de maior span ou a primeira)
    deduped: list[ParsedDate] = []
    last_end = -1
    for p in found:
        if p.start_char >= last_end:
            deduped.append(p)
            last_end = p.end_char

    return deduped


def add_days(base: datetime.date, days: int) -> datetime.date:
    """Soma N dias corridos a uma data."""
    return base + datetime.timedelta(days=days)


def add_months(base: datetime.date, months: int) -> datetime.date:
    """Aritmética de calendário somando N meses a uma data com ajuste de fim de mês."""
    month_idx = base.month - 1 + months
    new_year = base.year + month_idx // 12
    new_month = month_idx % 12 + 1
    max_day = calendar.monthrange(new_year, new_month)[1]
    return datetime.date(new_year, new_month, min(base.day, max_day))


def add_years(base: datetime.date, years: int) -> datetime.date:
    """Aritmética de calendário somando N anos a uma data (ajusta 29 de fev para 28)."""
    return add_months(base, years * 12)
