# Serviço de Extração de Documentos (OCR)

Microserviço HTTP em Python que realiza a leitura automática de anexos (PDF, PNG e JPEG) via Tesseract OCR (`por`) e aplica regras determinísticas para sugerir os campos **data de emissão**, **data de vencimento** e **órgão emissor** no cadastro de documentos do DocsObs.

## Endpoints

### `GET /health`

Retorna o estado do serviço e o motor de leitura ativo:

```json
{
  "status": "ok",
  "engine": "tesseract",
  "engine_version": "tesseract 5.3.0 / pytesseract 0.3.13 / lang=por / oem=1 / psm=3"
}
```

### `POST /extract`

Recebe os bytes brutos do documento no corpo da requisição e devolve os campos extraídos com pontuação de confiança (`0.0` a `1.0`):

```json
{
  "engine": "tesseract",
  "engine_version": "tesseract 5.3.0 / pytesseract 0.3.13 / lang=por / oem=1 / psm=3",
  "elapsed_s": 1.12,
  "fields": {
    "issueDate": {
      "value": "2026-03-15",
      "confidence": 0.95
    },
    "expirationDate": {
      "value": "2026-09-11",
      "confidence": 0.92
    },
    "issuingBody": {
      "value": "Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional",
      "confidence": 0.945
    }
  }
}
```

Quando um campo não é localizado ou possui validade indeterminada, `value` é `null` e `confidence` é `0.0`.

## Limites e Validação

- **Tamanho máximo do corpo:** 10 MB (`10.485.760` bytes). Arquivos maiores recebem `413 Request Entity Too Large`.
- **Formatos aceitos:** PDF (`%PDF`), PNG (`\x89PNG\r\n\x1a\n`) e JPEG (`\xff\xd8\xff`), validados exclusivamente pelos *magic bytes* do conteúdo. Outros formatos recebem `415 Unsupported Media Type`.

## Execução via Docker Compose

O serviço é ativado sob demanda pelo perfil opcional `extraction`:

```bash
docker compose --profile extraction up -d --build
```

Para que o backend consulte o serviço no Docker Compose, defina `EXTRACTION_SERVICE_URL=http://extraction:8000` no `.env`.

## Testes no Container

```bash
docker build -t docsobs-extraction:test extraction-service
docker run --rm docsobs-extraction:test sh -c "pip install -q pytest==8.3.3 && timeout 1500 python -m pytest -q tests/"
```
