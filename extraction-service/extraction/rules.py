"""Camada de regras para extração de campos em documentos empresariais.

Este módulo implementa a classe `RuleExtractor`, que atende ao protocolo `FieldExtractor`
(definido em `extraction/interface.py`).

A camada de regras opera sobre o `ReadResult` produzido pelo motor de leitura OCR
e extrai data de emissão, data de vencimento e órgão emissor com pontuação de confiança.

Restrições de projeto:
- Recebe EXCLUSIVAMENTE um objeto `ReadResult` (linhas com texto, bbox normalizado e confiança 0..1).
- É independente do formato de origem ou do motor de OCR utilizado (regras universais).
- Totalmente determinística: mesma entrada -> mesma saída.

Fórmula de Confiança:
---------------------
    confidence = ocr_conf × rule_weight × correction_penalty, com valor limitado a [0.0, 1.0]

Onde:
- `ocr_conf`: média aritmética da confiança do OCR para as linhas utilizadas
  (ex.: linha do rótulo + linha do valor na regra de proximidade; linha da validade +
  linha de emissão no vencimento derivado; ou a própria linha quando for rótulo na mesma linha).
- `rule_weight` depende da regra aplicada:
  | Regra                  | Peso (rule_weight)                                  |
  |------------------------|-----------------------------------------------------|
  | same_line (mesma linha)| 1.00                                                |
  | range (faixa validade) | 0.95                                                |
  | derived (derivado)     | 0.90                                                |
  | indeterminado          | 0.90                                                |
  | proximity (proximidade)| 0.80                                                |
  | fallback               | 0.40                                                |
  | body (órgão emissor)   | (score / 100) + 0.05 se a linha estiver no cabeçalho |
- `correction_penalty`: 0.85 quando foram necessárias correções de ruídos de caracteres
  de OCR (ex.: O/o->0, I/l/|->1, S->5, Z->2, B->8) dentro do token de data; 1.00 caso contrário.
- Se o campo não for localizado (value=None), confidence é fixado em 0.0.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from common import vocab
from extraction import dates
from extraction.interface import FieldPrediction, Line, ReadResult

# Palavras e expressões que indicam datas acessórias ou de controle, que NÃO devem ser
# selecionadas como data de emissão ou validade (distratores).
DISTRACTORS: tuple[str, ...] = (
    "consulta",
    "consultado",
    "protocolo",
    "alteração",
    "portaria",
    "lei",
    "decreto",
    "nascimento",
    "impresso em",
    "gerado em",
    "atualizado em",
)

# Regex compilada para detecção de distratores com fronteiras de palavra / expressões exatas
DISTRACTOR_REGEX = re.compile(
    r"\b(?:"
    r"consulta|consultad[ao]s?|protocolo|altera[cç][aã]o|altera[cç][oõ]es|"
    r"portaria|lei|decreto|nascimento|"
    r"impresso\s+em|gerado\s+em|atualizado\s+em"
    r")\b",
    re.IGNORECASE,
)

# Rótulos de emissão
ISSUE_LABELS: tuple[str, ...] = (
    "emitida em",
    "emitido em",
    "data de emissão",
    "data da emissão",
    "data de emissao",
    "data da emissao",
    "expedida em",
    "expedido em",
    "data de expedição",
    "data da expedição",
    "data de expedicao",
    "data da expedicao",
    "certidão emitida",
    "certidao emitida",
    "expedição",
    "expedicao",
)

# Regex específica para expressões do tipo 'emitida às ... do dia'
EMITIDA_AS_DO_DIA_RE = re.compile(
    r"emitid[ao]\s+[aà]s\b.*?\bdo\s+dia\b", re.IGNORECASE
)

# Rótulos de validade / vencimento
EXPIRATION_LABELS: tuple[str, ...] = (
    "válida até",
    "valida ate",
    "válido até",
    "valido ate",
    "data de validade",
    "data da validade",
    "data do vencimento",
    "data de vencimento",
    "vencimento",
    "validade:",
    "validade",
)

# Expressões de validade indeterminada
INDETERMINATE_PATTERNS: tuple[str, ...] = (
    "validade indeterminada",
    "prazo indeterminado",
    "por prazo indeterminado",
    "sem prazo de validade",
)

INDETERMINATE_REGEX = re.compile(
    r"\b(?:"
    r"validade\s+indeterminada|"
    r"prazo\s+indeterminado|"
    r"por\s+prazo\s+indeterminado|"
    r"sem\s+prazo\s+de\s+validade"
    r")\b",
    re.IGNORECASE,
)

WORD_NUMBERS: dict[str, int] = {
    "um": 1,
    "uma": 1,
    "dois": 2,
    "duas": 2,
    "tres": 3,
    "três": 3,
    "quatro": 4,
    "cinco": 5,
    "seis": 6,
    "sete": 7,
    "oito": 8,
    "nove": 9,
    "dez": 10,
    "quinze": 15,
    "vinte": 20,
    "trinta": 30,
    "quarenta e cinco": 45,
    "sessenta": 60,
    "noventa": 90,
    "cento e vinte": 120,
    "cento e oitenta": 180,
    "trezentos e sessenta": 360,
    "trezentos e sessenta e cinco": 365,
}

# Indicativos de validade para vencimento derivado (R1)
VALIDITY_CUES: tuple[str, ...] = (
    "prazo de validade",
    "validade",
    "válida",
    "valida",
    "válido",
    "valido",
    "vigência",
    "vigencia",
)

# Expressão para captura de duração em vencimento derivado (R1)
# Inteiro (ou por extenso), opcionalmente com extenso entre parênteses, seguido de unidade.
DERIVED_DURATION_RE = re.compile(
    r"\b(\d+|"
    + "|".join(re.escape(w) for w in sorted(WORD_NUMBERS, key=len, reverse=True))
    + r")\s*(?:\([^)]*\)\s*)?(dias?|meses|m[eê]s|mes|anos?)\b",
    re.IGNORECASE,
)


def _parse_duration_number(raw_num: str) -> int | None:
    """Extrai número inteiro de dígitos ou por extenso."""
    m = re.search(r"\b(\d+)\b", raw_num)
    if m:
        return int(m.group(1))
    clean = dates.strip_accents(raw_num).lower().strip()
    for word, val in WORD_NUMBERS.items():
        if dates.strip_accents(word) == clean:
            return val
    return None


def _has_validity_cue(text: str) -> bool:
    """Verifica se o texto contém um indicativo de validade/vigência (R1).

    Case- e accent-insensitive, com tolerância a OCR similar aos rótulos existentes.
    """
    norm_text = dates.strip_accents(text).lower()
    for cue in VALIDITY_CUES:
        norm_cue = dates.strip_accents(cue).lower()
        if norm_cue in norm_text:
            return True

    for cue in VALIDITY_CUES:
        norm_cue = dates.strip_accents(cue).lower()
        align = fuzz.partial_ratio_alignment(norm_cue, norm_text)
        if align.score >= 85.0:
            return True

    return False


def _find_derived_duration(line: Line) -> tuple[int, str] | None:
    """Verifica se a linha atende a todos os critérios de R1 para vencimento derivado:
    1. Contém indicativo de validade (validade, válida/valida, válido/valido, prazo de validade, vigência);
    2. Contém uma duração (inteiro, opcionalmente com extenso entre parênteses, + unidade dia/mês/ano);
    3. NÃO contém nenhuma data explícita reconhecida por dates.find_dates_in_text.

    Retorna (duração, unidade_normalizada) ou None.
    """
    # Critério 3: NENHUMA data explícita na linha
    if dates.find_dates_in_text(line.text):
        return None

    # Critério 1: Contém indicativo de validade
    if not _has_validity_cue(line.text):
        return None

    # Critério 2: Contém uma duração
    clean_text = dates.strip_accents(line.text).lower()
    m = DERIVED_DURATION_RE.search(clean_text)
    if not m:
        m = DERIVED_DURATION_RE.search(line.text)
    if not m:
        return None

    num_raw = m.group(1)
    unit_raw = m.group(2)
    duration = _parse_duration_number(num_raw)
    if duration is None:
        return None

    unit_clean = dates.strip_accents(unit_raw).lower()
    return duration, unit_clean


@dataclass(frozen=True)
class LineDate:
    """Uma data associada à linha de onde foi extraída."""

    line: Line
    line_index: int
    parsed: dates.ParsedDate
    is_distractor: bool


def _is_distractor_date(line: Line, parsed: dates.ParsedDate) -> bool:
    """Verifica se uma data em determinada linha se enquadra na exclusão de distratores."""
    prefix = line.text[: parsed.start_char]
    prefix_clean = dates.strip_accents(prefix).lower()

    # Se o texto imediatamente anterior à data for um rótulo de emissão ou validade, NÃO é distrator
    for lbl in ISSUE_LABELS:
        if dates.strip_accents(lbl).lower() in prefix_clean:
            return False
    for lbl in EXPIRATION_LABELS:
        if dates.strip_accents(lbl).lower() in prefix_clean:
            return False
    if EMITIDA_AS_DO_DIA_RE.search(prefix):
        return False

    # Se o prefixo contiver termo de distrator, é distrator
    if DISTRACTOR_REGEX.search(prefix):
        return True

    # Se a linha como um todo contiver distrator e não tiver rótulo de emissão/validade anterior à data
    if DISTRACTOR_REGEX.search(line.text):
        return True

    return False


def _find_issue_label_span(text: str) -> tuple[int, int] | None:
    """Localiza o span (início, fim) de um rótulo de emissão na linha."""
    m_as = EMITIDA_AS_DO_DIA_RE.search(text)
    if m_as:
        return m_as.span()

    norm_text = dates.strip_accents(text).lower()
    for lbl in ISSUE_LABELS:
        norm_lbl = dates.strip_accents(lbl).lower()
        idx = norm_text.find(norm_lbl)
        if idx != -1:
            return (idx, idx + len(norm_lbl))

    # Fallback fuzzy para ruído de OCR no rótulo (ratio >= 85)
    for lbl in ISSUE_LABELS:
        norm_lbl = dates.strip_accents(lbl).lower()
        align = fuzz.partial_ratio_alignment(norm_lbl, norm_text)
        if align.score >= 85.0:
            return (align.dest_start, align.dest_end)

    return None


def _find_expiration_label_span(text: str) -> tuple[int, int] | None:
    """Localiza o span (início, fim) de um rótulo de validade na linha."""
    norm_text = dates.strip_accents(text).lower()
    # Checa primeiro os rótulos mais longos para evitar falso prefixo
    for lbl in sorted(EXPIRATION_LABELS, key=len, reverse=True):
        norm_lbl = dates.strip_accents(lbl).lower()
        idx = norm_text.find(norm_lbl)
        if idx != -1:
            return (idx, idx + len(norm_lbl))

    # Fallback fuzzy para ruído de OCR no rótulo
    for lbl in sorted(EXPIRATION_LABELS, key=len, reverse=True):
        norm_lbl = dates.strip_accents(lbl).lower()
        align = fuzz.partial_ratio_alignment(norm_lbl, norm_text)
        if align.score >= 85.0 and fuzz.ratio(norm_lbl, norm_text[align.dest_start : align.dest_end]) >= 85.0:
            return (align.dest_start, align.dest_end)

    return None


def _is_indeterminate(text: str) -> bool:
    """Verifica se a linha indica validade indeterminada de forma precisa."""
    text_clean = dates.strip_accents(text).lower()
    if INDETERMINATE_REGEX.search(text):
        return True
    # Fuzzy match apenas se a palavra distintiva 'indeterminad' ou a expressão 'sem prazo' estiver presente
    if "indeterminad" in text_clean or "sem prazo" in text_clean:
        return any(
            fuzz.partial_ratio(dates.strip_accents(pat).lower(), text_clean) >= 80.0
            for pat in INDETERMINATE_PATTERNS
        )
    return False


class RuleExtractor:
    """Camada de regras para extração de campos em documentos empresariais.

    Implementa a interface FieldExtractor (extraction.interface.FieldExtractor).
    Recebe apenas um ReadResult e retorna predições determinísticas para os três campos:
    - data_emissao
    - data_vencimento
    - orgao_emissor
    """

    def extract(self, read: ReadResult) -> dict[str, FieldPrediction]:
        """Extrai os três campos de vocab.FIELDS com base nas regras determinísticas."""
        # 1. Parsing de todas as datas de todas as linhas
        line_dates: list[LineDate] = []
        for idx, line in enumerate(read.lines):
            dates_in_line = dates.find_dates_in_text(line.text)
            for d in dates_in_line:
                distractor = _is_distractor_date(line, d)
                line_dates.append(LineDate(line=line, line_index=idx, parsed=d, is_distractor=distractor))

        # 2. Órgão emissor
        pred_orgao = self._extract_orgao(read)

        # 3. Faixa de validade (Validade: dd/mm/aaaa a dd/mm/aaaa)
        range_emissao, range_vencimento, range_line_idx = self._check_validity_range(read, line_dates)

        # 4. Data de emissão
        pred_emissao, issue_lines_used = self._extract_data_emissao(read, line_dates, range_emissao)

        # 5. Data de vencimento
        pred_vencimento = self._extract_data_vencimento(
            read, line_dates, range_vencimento, range_line_idx, pred_emissao, issue_lines_used
        )

        return {
            "data_emissao": pred_emissao,
            "data_vencimento": pred_vencimento,
            "orgao_emissor": pred_orgao,
        }

    def _extract_orgao(self, read: ReadResult) -> FieldPrediction:
        """Extrai o órgão emissor canônico por fuzzy matching contra vocab.ORGAOS."""
        best_candidate: tuple[vocab.Orgao, Line, float, bool] | None = None
        best_rank_score = -1.0

        for line in read.lines:
            # Cabeçalho: linhas nos primeiros 30% da página (ou y0 <= 0.30)
            in_header = (line.bbox[1] <= 0.30)

            # Normalização de pontuação e diacríticos para robustez contra ruídos de OCR
            clean_line = re.sub(r"[\-\/\.\,]", " ", dates.strip_accents(line.text)).lower()

            for orgao in vocab.ORGAOS:
                targets = (orgao.canonical,) + orgao.aliases
                for target in targets:
                    clean_target = re.sub(r"[\-\/\.\,]", " ", dates.strip_accents(target)).lower()
                    target_tokens = clean_target.split()

                    # Para siglas ou palavras únicas pequenas (<= 5 caracteres), usa token_set_ratio
                    # para evitar match parcial espúrio dentro de palavras maiores
                    if len(target_tokens) == 1 and len(clean_target) <= 5:
                        raw_score = fuzz.token_set_ratio(clean_target, clean_line)
                    else:
                        raw_score = max(
                            fuzz.token_set_ratio(clean_target, clean_line),
                            fuzz.partial_ratio(clean_target, clean_line),
                        )

                    if raw_score >= 85.0:
                        # Bônus de cabeçalho (+5 pontos no score de ordenação)
                        rank_score = raw_score + (5.0 if in_header else 0.0)
                        if rank_score > best_rank_score:
                            best_rank_score = rank_score
                            best_candidate = (orgao, line, raw_score, in_header)

        if not best_candidate:
            return FieldPrediction(
                value=None,
                confidence=0.0,
                derived=False,
                evidence=None,
                rule=None,
            )

        winner_orgao, winner_line, raw_score, in_header = best_candidate
        # Fórmula de confiança para órgão: (score / 100) + 0.05 de bônus no cabeçalho
        rule_weight = (raw_score / 100.0) + (0.05 if in_header else 0.0)
        confidence = min(1.0, max(0.0, round(winner_line.confidence * rule_weight, 4)))

        return FieldPrediction(
            value=winner_orgao.canonical,
            confidence=confidence,
            derived=False,
            evidence=winner_line.text,
            rule="body",
        )

    def _check_validity_range(
        self, read: ReadResult, line_dates: list[LineDate]
    ) -> tuple[FieldPrediction | None, FieldPrediction | None, int | None]:
        """Detecta padrão de faixa de validade: 'Validade: dd/mm/aaaa a dd/mm/aaaa'.

        Retorna (predicao_emissao_candidata, predicao_vencimento_candidata, linha_indice).
        """
        for idx, line in enumerate(read.lines):
            dates_in_this_line = [ld for ld in line_dates if ld.line_index == idx and not ld.is_distractor]
            if len(dates_in_this_line) < 2:
                continue

            clean_text = dates.strip_accents(line.text).lower()
            # Verifica se a linha tem indicador de validade ou vigência
            has_range_indicator = any(
                term in clean_text
                for term in ("validade", "valida", "vigencia", "vigência", "periodo", "período")
            )
            if not has_range_indicator:
                continue

            d1 = dates_in_this_line[0]
            d2 = dates_in_this_line[1]

            # Trecho entre as duas datas
            between = clean_text[d1.parsed.end_char : d2.parsed.start_char].strip()
            # Separador comum: 'a', 'ate', 'até', '-'
            is_range_sep = re.match(r"^(?:a|at[eé]|-)\b", between) is not None or between in ("a", "ate", "até", "-")

            if is_range_sep:
                rule_weight = 0.95
                corr_penalty_venc = 0.85 if d2.parsed.corrected else 1.0
                conf_venc = min(1.0, max(0.0, round(line.confidence * rule_weight * corr_penalty_venc, 4)))
                pred_venc = FieldPrediction(
                    value=d2.parsed.iso,
                    confidence=conf_venc,
                    derived=False,
                    evidence=line.text,
                    rule="range",
                )

                corr_penalty_emiss = 0.85 if d1.parsed.corrected else 1.0
                conf_emiss = min(1.0, max(0.0, round(line.confidence * rule_weight * corr_penalty_emiss, 4)))
                pred_emiss = FieldPrediction(
                    value=d1.parsed.iso,
                    confidence=conf_emiss,
                    derived=False,
                    evidence=line.text,
                    rule="range",
                )
                return pred_emiss, pred_venc, idx

        return None, None, None

    def _extract_data_emissao(
        self,
        read: ReadResult,
        line_dates: list[LineDate],
        range_emissao: FieldPrediction | None,
    ) -> tuple[FieldPrediction, list[Line]]:
        """Extrai a data de emissão segundo as regras determinísticas."""
        # Candidatos encontrados por rótulo na mesma linha
        same_line_candidates: list[tuple[FieldPrediction, Line]] = []
        # Linhas com rótulo de emissão sem data na mesma linha (para busca por proximidade)
        unmatched_label_lines: list[tuple[int, Line]] = []

        for idx, line in enumerate(read.lines):
            label_span = _find_issue_label_span(line.text)
            if not label_span:
                continue

            lbl_start, lbl_end = label_span
            dates_in_this_line = [ld for ld in line_dates if ld.line_index == idx and not ld.is_distractor]

            # Procura data após o rótulo na mesma linha
            same_line_date = next(
                (ld for ld in dates_in_this_line if ld.parsed.start_char >= lbl_end - 2),
                None,
            )

            if same_line_date:
                rule_weight = 1.0
                corr_penalty = 0.85 if same_line_date.parsed.corrected else 1.0
                conf = min(1.0, max(0.0, round(line.confidence * rule_weight * corr_penalty, 4)))
                pred = FieldPrediction(
                    value=same_line_date.parsed.iso,
                    confidence=conf,
                    derived=False,
                    evidence=line.text,
                    rule="same_line",
                )
                same_line_candidates.append((pred, line))
            else:
                unmatched_label_lines.append((idx, line))

        # 1. Se encontrou por rótulo na mesma linha, retorna o melhor candidato
        if same_line_candidates:
            # Ordena por maior confiança, desempata pela primeira linha no documento
            same_line_candidates.sort(key=lambda item: item[0].confidence, reverse=True)
            winner_pred, winner_line = same_line_candidates[0]
            return winner_pred, [winner_line]

        # 2. Busca por proximidade de bbox (linha seguinte abaixo ou à direita)
        for lbl_idx, lbl_line in unmatched_label_lines:
            prox_match = self._find_proximity_date(read, lbl_idx, line_dates)
            if prox_match:
                cand_line, cand_date = prox_match
                rule_weight = 0.8
                ocr_conf = (lbl_line.confidence + cand_line.confidence) / 2.0
                corr_penalty = 0.85 if cand_date.parsed.corrected else 1.0
                conf = min(1.0, max(0.0, round(ocr_conf * rule_weight * corr_penalty, 4)))
                pred = FieldPrediction(
                    value=cand_date.parsed.iso,
                    confidence=conf,
                    derived=False,
                    evidence=f"{lbl_line.text} -> {cand_line.text}",
                    rule="proximity",
                )
                return pred, [lbl_line, cand_line]

        # 3. Se não há rótulo de emissão, mas houve faixa de validade, usa o início da faixa
        if range_emissao is not None:
            ev_line = next((l for l in read.lines if l.text == range_emissao.evidence), read.lines[0])
            return range_emissao, [ev_line]

        # 4. Fallback: data válida mais antiga que não seja distrator
        valid_non_distractors = [ld for ld in line_dates if not ld.is_distractor]
        if valid_non_distractors:
            # Ordena por data cronológica (mais antiga primeiro)
            valid_non_distractors.sort(key=lambda ld: ld.parsed.date)
            earliest = valid_non_distractors[0]
            rule_weight = 0.4
            corr_penalty = 0.85 if earliest.parsed.corrected else 1.0
            conf = min(1.0, max(0.0, round(earliest.line.confidence * rule_weight * corr_penalty, 4)))
            pred = FieldPrediction(
                value=earliest.parsed.iso,
                confidence=conf,
                derived=False,
                evidence=earliest.line.text,
                rule="fallback",
            )
            return pred, [earliest.line]

        # 5. Nenhum candidato
        return (
            FieldPrediction(
                value=None,
                confidence=0.0,
                derived=False,
                evidence=None,
                rule=None,
            ),
            [],
        )

    def _extract_data_vencimento(
        self,
        read: ReadResult,
        line_dates: list[LineDate],
        range_vencimento: FieldPrediction | None,
        range_line_idx: int | None,
        pred_emissao: FieldPrediction,
        issue_lines_used: list[Line],
    ) -> FieldPrediction:
        """Extrai a data de vencimento segundo a hierarquia de regras determinísticas (R3).

        Ordem de precedência:
        1. indeterminado;
        2. faixa (range);
        3. rótulo na mesma linha com data (same_line);
        4. derivado (R1);
        5. proximidade (proximity, com R2);
        6. fallback (com R2).
        """
        # 1. Validade indeterminada - peso 0.90
        for line in read.lines:
            if _is_indeterminate(line.text):
                rule_weight = 0.9
                conf = min(1.0, max(0.0, round(line.confidence * rule_weight, 4)))
                return FieldPrediction(
                    value=vocab.ABSENT,
                    confidence=conf,
                    derived=False,
                    evidence=line.text,
                    rule="indeterminado",
                )

        # 2. Faixa de validade (fim da faixa) - peso 0.95
        # Se houve faixa de validade explicitada ('Validade: 01/10/2026 a 30/10/2026'),
        # o vencimento é o término da faixa.
        if range_vencimento is not None:
            return range_vencimento

        # 3. Rótulo de validade na mesma linha com data (same_line) - peso 1.00
        same_line_candidates: list[FieldPrediction] = []
        unmatched_label_lines: list[tuple[int, Line]] = []

        for idx, line in enumerate(read.lines):
            # Ignora a linha se já tiver sido consumida por faixa
            if range_line_idx is not None and idx == range_line_idx:
                continue

            label_span = _find_expiration_label_span(line.text)
            if not label_span:
                continue

            lbl_start, lbl_end = label_span
            dates_in_this_line = [ld for ld in line_dates if ld.line_index == idx and not ld.is_distractor]

            # Data após o rótulo
            same_line_date = next(
                (ld for ld in dates_in_this_line if ld.parsed.start_char >= lbl_end - 2),
                None,
            )

            if same_line_date:
                rule_weight = 1.0
                corr_penalty = 0.85 if same_line_date.parsed.corrected else 1.0
                conf = min(1.0, max(0.0, round(line.confidence * rule_weight * corr_penalty, 4)))
                pred = FieldPrediction(
                    value=same_line_date.parsed.iso,
                    confidence=conf,
                    derived=False,
                    evidence=line.text,
                    rule="same_line",
                )
                same_line_candidates.append(pred)
            elif _find_derived_duration(line) is None:
                # Linha com rótulo sem data que não é declaração derivada
                unmatched_label_lines.append((idx, line))

        if same_line_candidates:
            same_line_candidates.sort(key=lambda p: p.confidence, reverse=True)
            return same_line_candidates[0]

        # 4. Vencimento derivado (R1) - peso 0.90
        # A line is a derived-validity statement when ALL of these hold:
        # - it contains a validity cue (validade, válida/valida, válido/valido, prazo de validade, vigência)
        # - it contains a duration (integer + unit: dias, meses, anos)
        # - it contains NO explicit date (dates.find_dates_in_text is empty)
        for line in read.lines:
            derived_match = _find_derived_duration(line)
            if derived_match is not None:
                duration, unit_clean = derived_match
                if pred_emissao.value and pred_emissao.value != vocab.ABSENT:
                    try:
                        emiss_parts = [int(p) for p in pred_emissao.value.split("-")]
                        base_date = dates.datetime.date(emiss_parts[0], emiss_parts[1], emiss_parts[2])

                        if "dia" in unit_clean:
                            venc_date = dates.add_days(base_date, duration)
                        elif "mes" in unit_clean:
                            venc_date = dates.add_months(base_date, duration)
                        elif "ano" in unit_clean:
                            venc_date = dates.add_years(base_date, duration)
                        else:
                            venc_date = dates.add_days(base_date, duration)

                        rule_weight = 0.9
                        # Confiança média das linhas utilizadas (linha de validade + linhas de emissão)
                        used_confs = [line.confidence] + [l.confidence for l in issue_lines_used]
                        ocr_conf = sum(used_confs) / len(used_confs)
                        conf = min(1.0, max(0.0, round(ocr_conf * rule_weight, 4)))

                        return FieldPrediction(
                            value=venc_date.isoformat(),
                            confidence=conf,
                            derived=True,
                            evidence=line.text,
                            rule="derived",
                        )
                    except (ValueError, IndexError):
                        pass

                # Caso a data de emissão não tenha sido encontrada: retorna value=None, derived=True
                return FieldPrediction(
                    value=None,
                    confidence=0.0,
                    derived=True,
                    evidence=line.text,
                    rule="derived",
                )

        # 5. Rótulo com data por proximidade de bbox (R2) - peso 0.80
        # R2: Uma data em linha com rótulo de emissão jamais é selecionada para data_vencimento
        venc_line_dates = [
            ld for ld in line_dates if _find_issue_label_span(ld.line.text) is None
        ]

        for lbl_idx, lbl_line in unmatched_label_lines:
            prox_match = self._find_proximity_date(read, lbl_idx, venc_line_dates)
            if prox_match:
                cand_line, cand_date = prox_match
                rule_weight = 0.8
                ocr_conf = (lbl_line.confidence + cand_line.confidence) / 2.0
                corr_penalty = 0.85 if cand_date.parsed.corrected else 1.0
                conf = min(1.0, max(0.0, round(ocr_conf * rule_weight * corr_penalty, 4)))
                return FieldPrediction(
                    value=cand_date.parsed.iso,
                    confidence=conf,
                    derived=False,
                    evidence=f"{lbl_line.text} -> {cand_line.text}",
                    rule="proximity",
                )

        # 6. Fallback: data válida mais recente que seja posterior à data de emissão (R2) - peso 0.40
        if pred_emissao.value and pred_emissao.value != vocab.ABSENT:
            try:
                emiss_parts = [int(p) for p in pred_emissao.value.split("-")]
                emiss_date = dates.datetime.date(emiss_parts[0], emiss_parts[1], emiss_parts[2])

                later_dates = [
                    ld for ld in venc_line_dates if not ld.is_distractor and ld.parsed.date > emiss_date
                ]
                if later_dates:
                    # Mais recente (última no tempo)
                    later_dates.sort(key=lambda ld: ld.parsed.date, reverse=True)
                    latest = later_dates[0]
                    rule_weight = 0.4
                    corr_penalty = 0.85 if latest.parsed.corrected else 1.0
                    conf = min(1.0, max(0.0, round(latest.line.confidence * rule_weight * corr_penalty, 4)))
                    return FieldPrediction(
                        value=latest.parsed.iso,
                        confidence=conf,
                        derived=False,
                        evidence=latest.line.text,
                        rule="fallback",
                    )
            except (ValueError, IndexError):
                pass

        # 7. Nenhum candidato
        return FieldPrediction(
            value=None,
            confidence=0.0,
            derived=False,
            evidence=None,
            rule=None,
        )

    def _find_proximity_date(
        self, read: ReadResult, label_line_idx: int, line_dates: list[LineDate]
    ) -> tuple[Line, LineDate] | None:
        """Encontra a data mais próxima abaixo ou à direita do rótulo via coordenadas de bbox."""
        lbl_line = read.lines[label_line_idx]
        lx0, ly0, lx1, ly1 = lbl_line.bbox
        lh = max(ly1 - ly0, 0.015)

        candidates: list[tuple[float, Line, LineDate]] = []

        for ld in line_dates:
            if ld.line_index == label_line_idx or ld.is_distractor:
                continue

            cand_line = ld.line
            if cand_line.page != lbl_line.page:
                continue

            cx0, cy0, cx1, cy1 = cand_line.bbox

            # Relação 1: Linha abaixo do rótulo dentro de uma janela de até ~3.5 alturas de linha
            # com sobreposição horizontal
            is_below = (cy0 >= ly0 - 0.5 * lh) and (cy0 <= ly1 + 3.5 * lh)
            overlap_x = min(lx1, cx1) - max(lx0, cx0)
            has_horizontal_alignment = (overlap_x > 0) or (abs(cx0 - lx0) <= 0.15)

            # Relação 2: Linha à direita do rótulo na mesma faixa horizontal
            is_to_right = (cx0 >= lx0) and (cx0 <= lx1 + 0.5)
            overlap_y = min(ly1, cy1) - max(ly0, cy0)
            has_vertical_alignment = (overlap_y > 0) or (abs(cy0 - ly0) <= lh)

            if (is_below and has_horizontal_alignment) or (is_to_right and has_vertical_alignment):
                # Distância euclidiana entre os centros das caixas
                center_lx, center_ly = (lx0 + lx1) / 2.0, (ly0 + ly1) / 2.0
                center_cx, center_cy = (cx0 + cx1) / 2.0, (cy0 + cy1) / 2.0
                dist = math.hypot(center_cx - center_lx, center_cy - center_ly)
                candidates.append((dist, cand_line, ld))

        if candidates:
            # Seleciona o candidato com menor distância física
            candidates.sort(key=lambda item: item[0])
            return candidates[0][1], candidates[0][2]

        return None
