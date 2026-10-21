"""Vocabulário controlado do serviço de extração de documentos.

Define os campos extraídos, o marcador de ausência e a lista canônica de órgãos
emissores reconhecidos pela camada de regras.
"""

from __future__ import annotations

from dataclasses import dataclass

# Campos extraídos pelo leitor de documentos.
FIELDS: tuple[str, ...] = ("data_emissao", "data_vencimento", "orgao_emissor")

# Valor retornado pela camada de regras quando o campo é explicitamente ausente
# no documento (ex.: validade indeterminada para data_vencimento).
ABSENT = "AUSENTE"


@dataclass(frozen=True)
class Orgao:
    canonical: str
    aliases: tuple[str, ...]


# Nomes canônicos de órgãos emissores. Os aliases são formas que podem aparecer
# no corpo do documento; a regra de normalização compara o texto lido com
# canonical + aliases.
ORGAOS: tuple[Orgao, ...] = (
    Orgao(
        "Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional",
        (
            "Secretaria Especial da Receita Federal do Brasil",
            "Receita Federal do Brasil",
            "Procuradoria-Geral da Fazenda Nacional",
            "RFB/PGFN",
        ),
    ),
    Orgao(
        "Secretaria da Fazenda e Planejamento do Estado de São Paulo",
        ("Secretaria da Fazenda do Estado de São Paulo", "SEFAZ-SP"),
    ),
    Orgao(
        "Secretaria de Estado da Fazenda do Paraná",
        ("Secretaria da Fazenda do Paraná", "SEFA-PR"),
    ),
    Orgao(
        "Secretaria de Estado de Fazenda de Minas Gerais",
        ("Secretaria da Fazenda de Minas Gerais", "SEF-MG"),
    ),
    Orgao(
        "Prefeitura Municipal de Curitiba",
        ("Prefeitura de Curitiba", "Município de Curitiba", "Secretaria Municipal de Finanças de Curitiba"),
    ),
    Orgao(
        "Prefeitura do Município de São Paulo",
        ("Prefeitura de São Paulo", "Secretaria Municipal da Fazenda de São Paulo"),
    ),
    Orgao(
        "Prefeitura Municipal de Belo Horizonte",
        ("Prefeitura de Belo Horizonte", "Secretaria Municipal de Fazenda de Belo Horizonte"),
    ),
    Orgao(
        "Caixa Econômica Federal",
        ("CAIXA", "Caixa Econômica Federal - Agente Operador do FGTS"),
    ),
    Orgao(
        "Tribunal Superior do Trabalho",
        ("Poder Judiciário - Justiça do Trabalho", "Justiça do Trabalho", "TST"),
    ),
    Orgao(
        "Instituto Água e Terra",
        ("IAT", "Instituto Água e Terra do Paraná"),
    ),
    Orgao(
        "Companhia Ambiental do Estado de São Paulo",
        ("CETESB",),
    ),
    Orgao(
        "Fundação Estadual do Meio Ambiente de Minas Gerais",
        ("FEAM", "Fundação Estadual do Meio Ambiente"),
    ),
    Orgao(
        "Vigilância Sanitária Municipal de Curitiba",
        ("Vigilância Sanitária de Curitiba", "VISA Curitiba"),
    ),
    Orgao(
        "Vigilância Sanitária Municipal de São Paulo",
        ("Vigilância Sanitária de São Paulo", "COVISA São Paulo"),
    ),
)

CANONICAL_ORGAOS: tuple[str, ...] = tuple(o.canonical for o in ORGAOS)
