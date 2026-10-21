"""Suíte de testes para a camada de regras de extração (extraction/rules.py).

Testa exaustivamente os cenários de extração de datas e órgão emissor:
1. Rótulos de emissão e vencimento na mesma linha (same_line, peso 1.0)
2. Associação de rótulo e data por proximidade de bbox (proximity, peso 0.8)
3. Data por extenso ('15 de março de 2026')
4. Ruído de OCR em data por extenso e ano com confusão de caracteres ('15 de rnarço de 2O26')
5. Vencimento derivado em dias a partir da data de expedição (derived=True, peso 0.9)
6. Faixa de validade ('Validade: dd/mm/aaaa a dd/mm/aaaa') - fim é vencimento, início é emissão se não houver rótulo
7. Validade indeterminada ('por prazo indeterminado' -> data_vencimento = vocab.ABSENT, regra 'indeterminado')
8. Exclusão de distratores ('consulta', 'protocolo', 'lei', etc. nunca selecionados)
9. Vencimento derivado em anos ('prazo de validade de 4 anos', derived=True)
10. Órgão emissor no cabeçalho com correspondência para nome canônico
11. Órgão no cabeçalho preferido contra citação no corpo
12. Documento sem datas e sem órgão conhecido (valores None, confiança 0.0)
13. Data impossível (ex.: 31/02/2026 rejeitada)
14. Vencimento derivado sem data de emissão encontrada (vencimento None, derived=True, evidência preservada)
15. Determinismo (duas chamadas sucessivas retornam saídas idênticas)
16. Regra de fallback quando não há rótulos (peso 0.4)
17. Variações de separadores e formatação de datas numéricas
18. Cálculo exato da fórmula de confiança e penalidade de correção
"""

from __future__ import annotations

import pytest

from common import vocab
from extraction.interface import Line, ReadResult
from extraction.rules import RuleExtractor


def make_read(
    lines_spec: list[str | tuple[str, tuple[float, float, float, float], float]],
    default_conf: float = 0.9,
    engine: str = "test-engine",
) -> ReadResult:
    """Helper para construir ReadResult de teste com bboxes empilhados e confiança padrão."""
    line_objs: list[Line] = []
    y = 0.05
    for item in lines_spec:
        if isinstance(item, str):
            line_objs.append(
                Line(
                    text=item,
                    bbox=(0.1, y, 0.6, y + 0.03),
                    confidence=default_conf,
                    page=0,
                )
            )
            y += 0.04
        elif isinstance(item, tuple):
            text, bbox, conf = item
            line_objs.append(Line(text=text, bbox=bbox, confidence=conf, page=0))
    return ReadResult(
        engine=engine,
        engine_version="1.0.0",
        lines=tuple(line_objs),
        elapsed_s=0.05,
        peak_rss_mb=12.5,
    )


@pytest.fixture
def extractor() -> RuleExtractor:
    return RuleExtractor()


# Caso 1: Rótulos na mesma linha
def test_case_01_same_line_dates(extractor: RuleExtractor):
    read = make_read(["Certidão emitida em 15/03/2026", "Válida até 11/09/2026"])
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-03-15"
    assert res["data_emissao"].rule == "same_line"
    assert res["data_emissao"].confidence == pytest.approx(0.9)
    assert not res["data_emissao"].derived

    assert res["data_vencimento"].value == "2026-09-11"
    assert res["data_vencimento"].rule == "same_line"
    assert res["data_vencimento"].confidence == pytest.approx(0.9)
    assert not res["data_vencimento"].derived


# Caso 2: Rótulo com valor na linha de baixo (proximidade de bbox, peso 0.8)
def test_case_02_proximity_dates(extractor: RuleExtractor):
    read = make_read(
        [
            ("Data de emissão:", (0.1, 0.20, 0.40, 0.23), 0.9),
            ("15/03/2026", (0.1, 0.24, 0.30, 0.27), 0.9),
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-03-15"
    assert res["data_emissao"].rule == "proximity"
    # ocr_conf = 0.9, rule_weight = 0.8 -> conf = 0.72
    assert res["data_emissao"].confidence == pytest.approx(0.72)


# Caso 3: Data por extenso
def test_case_03_written_date_full(extractor: RuleExtractor):
    read = make_read(["Emitida em 15 de março de 2026"])
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-03-15"
    assert res["data_emissao"].rule == "same_line"
    assert res["data_emissao"].confidence == pytest.approx(0.9)


# Caso 4: Ruído de OCR em data por extenso e confusão de caracteres (O -> 0)
def test_case_04_ocr_noise_and_correction_penalty(extractor: RuleExtractor):
    read = make_read(["Emitida em 15 de rnarço de 2O26"])
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-03-15"
    # Penalidade de correção aplicada: 0.9 * 1.0 * 0.85 = 0.765
    assert res["data_emissao"].confidence == pytest.approx(0.765)


# Caso 5: Vencimento derivado em dias a partir da expedição
def test_case_05_derived_expiration_days(extractor: RuleExtractor):
    read = make_read(
        [
            "Expedida em 01/02/2026",
            "Validade: 180 (cento e oitenta) dias, contados da data de sua expedição",
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-02-01"
    # 01/02/2026 + 180 dias = 31/07/2026
    assert res["data_vencimento"].value == "2026-07-31"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"
    assert res["data_vencimento"].confidence == pytest.approx(0.81)


# Caso 6: Faixa de validade (Validade: 01/10/2026 a 30/10/2026)
def test_case_06_validity_range_without_issue_label(extractor: RuleExtractor):
    read = make_read(["Validade: 01/10/2026 a 30/10/2026"])
    res = extractor.extract(read)

    # Início vira data de emissão se não houver rótulo de emissão
    assert res["data_emissao"].value == "2026-10-01"
    assert res["data_emissao"].rule == "range"
    assert res["data_emissao"].confidence == pytest.approx(0.9 * 0.95)

    # Fim da faixa é a data de vencimento
    assert res["data_vencimento"].value == "2026-10-30"
    assert res["data_vencimento"].rule == "range"
    assert res["data_vencimento"].confidence == pytest.approx(0.9 * 0.95)


def test_case_06b_validity_range_with_explicit_issue_label(extractor: RuleExtractor):
    read = make_read(
        [
            "Data de emissão: 15/09/2026",
            "Validade: 01/10/2026 a 30/10/2026",
        ]
    )
    res = extractor.extract(read)

    # Rótulo explícito tem precedência sobre o início da faixa
    assert res["data_emissao"].value == "2026-09-15"
    assert res["data_emissao"].rule == "same_line"
    assert res["data_vencimento"].value == "2026-10-30"
    assert res["data_vencimento"].rule == "range"


# Caso 7: Validade indeterminada
def test_case_07_indeterminate_validity(extractor: RuleExtractor):
    read = make_read(
        [
            "Alvará de licença por prazo indeterminado",
            "Emitido em 05/05/2026",
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-05-05"
    assert res["data_vencimento"].value == vocab.ABSENT
    assert res["data_vencimento"].rule == "indeterminado"
    assert res["data_vencimento"].confidence == pytest.approx(0.9 * 0.9)


# Caso 8: Exclusão de distratores
def test_case_08_distractor_exclusion(extractor: RuleExtractor):
    read = make_read(
        [
            "Consulta realizada em 14/03/2026",
            "Emitida em 15/03/2026",
            "Válida até 11/09/2026",
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-03-15"
    assert res["data_vencimento"].value == "2026-09-11"
    # A data de consulta (14/03/2026) jamais é selecionada
    assert res["data_emissao"].value != "2026-03-14"
    assert res["data_vencimento"].value != "2026-03-14"


# Caso 9: Vencimento derivado em anos
def test_case_09_derived_expiration_years(extractor: RuleExtractor):
    read = make_read(
        [
            "Prazo de validade de 4 anos",
            "Emitida em 10/01/2026",
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-01-10"
    assert res["data_vencimento"].value == "2030-01-10"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 10: Órgão emissor no cabeçalho
def test_case_10_issuing_body_header(extractor: RuleExtractor):
    read = make_read(
        [
            ("SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL", (0.1, 0.05, 0.9, 0.08), 0.9),
        ]
    )
    res = extractor.extract(read)

    expected = "Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional"
    assert res["orgao_emissor"].value == expected
    assert res["orgao_emissor"].rule == "body"
    assert res["orgao_emissor"].value in vocab.CANONICAL_ORGAOS
    # Cabeçalho recebe bônus de 0.05: conf = 0.9 * (1.0 + 0.05) = 0.945
    assert res["orgao_emissor"].confidence == pytest.approx(0.945)


# Caso 11: Órgão no cabeçalho vs citação no corpo
def test_case_11_issuing_body_header_vs_citation(extractor: RuleExtractor):
    read = make_read(
        [
            ("CAIXA", (0.1, 0.05, 0.4, 0.09), 0.95),
            ("Ministério do Trabalho", (0.1, 0.50, 0.6, 0.54), 0.90),
        ]
    )
    res = extractor.extract(read)

    assert res["orgao_emissor"].value == "Caixa Econômica Federal"
    assert res["orgao_emissor"].value in vocab.CANONICAL_ORGAOS


# Caso 12: Sem datas e sem órgão conhecido
def test_case_12_no_dates_no_body(extractor: RuleExtractor):
    read = make_read(["Documento de homologação genérico", "Sem nenhuma data e sem orgao"])
    res = extractor.extract(read)

    for field_name in vocab.FIELDS:
        assert res[field_name].value is None
        assert res[field_name].confidence == 0.0


# Caso 13: Data impossível (ex.: 31/02/2026) rejeitada
def test_case_13_impossible_date(extractor: RuleExtractor):
    read = make_read(["Válida até 31/02/2026"])
    res = extractor.extract(read)

    assert res["data_vencimento"].value is None
    assert res["data_vencimento"].confidence == 0.0


# Caso 14: Vencimento derivado sem data de emissão
def test_case_14_derived_without_issue_date(extractor: RuleExtractor):
    read = make_read(
        ["Validade: 180 (cento e oitenta) dias, contados da data de sua expedição"]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value is None
    assert res["data_vencimento"].value is None
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"
    assert res["data_vencimento"].confidence == 0.0
    assert "180" in str(res["data_vencimento"].evidence)


# Caso 15: Determinismo
def test_case_15_determinism(extractor: RuleExtractor):
    read = make_read(
        [
            "Certidão emitida em 15/03/2026",
            "Válida até 11/09/2026",
            "SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL",
        ]
    )
    res1 = extractor.extract(read)
    res2 = extractor.extract(read)

    assert res1 == res2
    for f in vocab.FIELDS:
        assert res1[f].value == res2[f].value
        assert res1[f].confidence == res2[f].confidence
        assert res1[f].derived == res2[f].derived
        assert res1[f].evidence == res2[f].evidence
        assert res1[f].rule == res2[f].rule


# Testes Adicionais: Fallback quando não há rótulos (peso 0.4)
def test_fallback_selection_dates(extractor: RuleExtractor):
    read = make_read(
        [
            ("20/01/2026", (0.1, 0.40, 0.3, 0.43), 0.9),
            ("25/08/2026", (0.1, 0.60, 0.3, 0.63), 0.9),
        ]
    )
    res = extractor.extract(read)

    # Emissão vira a mais antiga
    assert res["data_emissao"].value == "2026-01-20"
    assert res["data_emissao"].rule == "fallback"
    assert res["data_emissao"].confidence == pytest.approx(0.9 * 0.4)

    # Vencimento vira a mais recente posterior à emissão
    assert res["data_vencimento"].value == "2026-08-25"
    assert res["data_vencimento"].rule == "fallback"
    assert res["data_vencimento"].confidence == pytest.approx(0.9 * 0.4)


def test_fallback_ignores_distractors(extractor: RuleExtractor):
    read = make_read(
        [
            "Consulta realizada em 01/01/2026",
            "20/01/2026",
            "25/08/2026",
        ]
    )
    res = extractor.extract(read)

    # Consulta foi ignorada como distrator
    assert res["data_emissao"].value == "2026-01-20"
    assert res["data_vencimento"].value == "2026-08-25"


# Teste Adicional: Vencimento derivado em meses
def test_derived_expiration_months(extractor: RuleExtractor):
    read = make_read(
        [
            "Emitida em 15/01/2026",
            "Válida por 6 meses",
        ]
    )
    res = extractor.extract(read)

    assert res["data_emissao"].value == "2026-01-15"
    assert res["data_vencimento"].value == "2026-07-15"
    assert res["data_vencimento"].derived is True


# Teste Adicional: Variações de separadores de data
@pytest.mark.parametrize(
    "date_str,expected",
    [
        ("15.03.2026", "2026-03-15"),
        ("15-03-2026", "2026-03-15"),
        ("5/3/2026", "2026-03-05"),
        ("01/01/2026", "2026-01-01"),
    ],
)
def test_date_delimiters_and_padding(extractor: RuleExtractor, date_str: str, expected: str):
    read = make_read([f"Emitida em {date_str}"])
    res = extractor.extract(read)
    assert res["data_emissao"].value == expected


# Teste Adicional: Confusões de OCR em dígitos (I, l, |, S, B, Z)
@pytest.mark.parametrize(
    "raw_date,expected",
    [
        ("OI/O2/2O26", "2026-02-01"),
        ("I5/03/2026", "2026-03-15"),
        ("l5/03/2026", "2026-03-15"),
        ("2S/05/2026", "2026-05-25"),
        ("0B/08/2026", "2026-08-08"),
        ("10/10/2O2Z", "2022-10-10"),
    ],
)
def test_ocr_digit_confusions(extractor: RuleExtractor, raw_date: str, expected: str):
    read = make_read([f"Emitida em {raw_date}"])
    res = extractor.extract(read)
    assert res["data_emissao"].value == expected
    # Penalidade de correção deve ter sido aplicada (0.9 * 1.0 * 0.85 = 0.765)
    assert res["data_emissao"].confidence == pytest.approx(0.765)


# Teste Adicional: Todas as variações de validade indeterminada
@pytest.mark.parametrize(
    "phrase",
    [
        "validade indeterminada",
        "prazo indeterminado",
        "por prazo indeterminado",
        "sem prazo de validade",
    ],
)
def test_all_indeterminate_phrases(extractor: RuleExtractor, phrase: str):
    read = make_read([f"Documento com {phrase}"])
    res = extractor.extract(read)
    assert res["data_vencimento"].value == vocab.ABSENT
    assert res["data_vencimento"].rule == "indeterminado"


# Teste Adicional: Todos os órgãos canônicos conhecidos de vocab.ORGAOS
def test_issuing_bodies_canonical_return(extractor: RuleExtractor):
    for orgao in vocab.ORGAOS:
        read = make_read([(orgao.canonical, (0.1, 0.05, 0.9, 0.08), 0.9)])
        res = extractor.extract(read)
        assert res["orgao_emissor"].value == orgao.canonical
        assert res["orgao_emissor"].value in vocab.CANONICAL_ORGAOS


# =============================================================================
# Casos de vencimento derivado e precedência de regras
# =============================================================================

# Caso 1: validade de 180 dias a contar de sua emissão
def test_case_table_01_derived_180_days_emissao(extractor: RuleExtractor):
    read = make_read(
        [
            "Esta certidão tem validade de 180 dias a contar de sua emissão",
            "Data de expedição: 26/06/2025",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2025-12-23"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 2: validade de 5 anos a partir da expedição
def test_case_table_02_derived_5_years_expedicao(extractor: RuleExtractor):
    read = make_read(
        [
            "Validade de 5 anos a partir da expedição",
            "Emitida em: 05/08/2025",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2030-08-05"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 3: prazo de validade de 5 anos a contar da data de emissão
def test_case_table_03_derived_5_years_prazo_validade(extractor: RuleExtractor):
    read = make_read(
        [
            "Prazo de validade de 5 anos a contar da data de emissão",
            "Emitida em 10/01/2026",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2031-01-10"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 4: validade de 1 ano contado da data de emissão (com data por extenso)
def test_case_table_04_derived_1_year_written_date(extractor: RuleExtractor):
    read = make_read(
        [
            "Validade de 1 ano contado da data de emissão",
            "Emitida em: 7 de agosto de 2025",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-08-07"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 5: vigência de 90 dias sem frase de ancoragem
def test_case_table_05_derived_vigencia_no_anchor(extractor: RuleExtractor):
    read = make_read(
        [
            "Vigência de 90 dias",
            "Emitida em 01/03/2026",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-05-30"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 6: validade: 180 (cento e oitenta) dias, contados da data de sua expedição
def test_case_table_06_derived_180_days_parentheses(extractor: RuleExtractor):
    read = make_read(
        [
            "Validade: 180 (cento e oitenta) dias, contados da data de sua expedição",
            "Expedida em 01/02/2026",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-07-31"
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"


# Caso 7: validade: 01/10/2026 a 30/10/2026 (faixa)
def test_case_table_07_validity_range_unchanged(extractor: RuleExtractor):
    read = make_read(["Validade: 01/10/2026 a 30/10/2026"])
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-10-30"
    assert res["data_vencimento"].rule == "range"
    assert res["data_vencimento"].derived is False


# Caso 8: data de validade na mesma linha tem precedência máxima
def test_case_table_08_same_line_beats_everything(extractor: RuleExtractor):
    read = make_read(
        [
            "Data de validade: 11/09/2026",
            "Data de expedição: 15/03/2026",
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-09-11"
    assert res["data_vencimento"].rule == "same_line"
    assert res["data_vencimento"].derived is False


# Caso 9: rótulo sozinho e data de expedição na linha de baixo (R2: posse do rótulo)
def test_case_table_09_label_alone_issue_label_next_line_r2(extractor: RuleExtractor):
    read = make_read(
        [
            ("Validade", (0.1, 0.20, 0.40, 0.23), 0.9),
            ("Data de expedição: 26/06/2025", (0.1, 0.24, 0.40, 0.27), 0.9),
        ]
    )
    res = extractor.extract(read)
    # R2: data na linha de expedição não pode ser capturada como vencimento por proximidade
    assert res["data_vencimento"].value != "2025-06-26"
    assert res["data_vencimento"].value is None
    assert res["data_vencimento"].confidence == 0.0


# Caso 10: rótulo sozinho e data isolada sem rótulo na linha de baixo (proximidade preservada)
def test_case_table_10_label_alone_unlabeled_date_proximity(extractor: RuleExtractor):
    read = make_read(
        [
            ("Validade", (0.1, 0.20, 0.40, 0.23), 0.9),
            ("30/12/2026", (0.1, 0.24, 0.30, 0.27), 0.9),
        ]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value == "2026-12-30"
    assert res["data_vencimento"].rule == "proximity"
    assert res["data_vencimento"].derived is False


# Caso 11: declaração territorial sem duração e sem data
def test_case_table_11_territorial_validity_no_duration_no_date(extractor: RuleExtractor):
    read = make_read(
        ["Válida em todo o território nos termos da legislação aplicável."]
    )
    res = extractor.extract(read)
    assert res["data_vencimento"].value is None
    assert res["data_vencimento"].derived is False
    assert res["data_vencimento"].rule is None


# Caso 12: declaração com duração mas sem data de emissão no documento
def test_case_table_12_derived_duration_without_issue_date(extractor: RuleExtractor):
    read = make_read(["Validade de 180 dias"])
    res = extractor.extract(read)
    assert res["data_vencimento"].value is None
    assert res["data_vencimento"].derived is True
    assert res["data_vencimento"].rule == "derived"
    assert res["data_vencimento"].confidence == 0.0


# Caso 13: prazo de validade indeterminado
def test_case_table_13_prazo_de_validade_indeterminado(extractor: RuleExtractor):
    read = make_read(["Prazo de validade: Indeterminado"])
    res = extractor.extract(read)
    assert res["data_vencimento"].value == vocab.ABSENT
    assert res["data_vencimento"].rule == "indeterminado"
