---
id: T-261014-6ea081-tc-e2e-05-desatualizado-apos-sync-real-do-google
room: bugfix
created: 2026-10-14T15:52:25.845Z
---

# Goal

TC-E2E-05 desatualizado apos sync real do Google (DOC-28)

## Acceptance

- [x] TC-E2E-05 valida o comportamento real: sync processa o documento (total >= 1) e registra log ERROR "Usuário não conectou o Google Agenda." sem conta conectada
- [x] Suite E2E completa verde

## Context

- Encontrado ao rodar o E2E do DOC-32 (18/19). backend/tests/e2e/05-calendar-events.test.ts:44 esperava synced >= 1 (sync simulado da Fase 4); desde DOC-28/ADR-009 o sync e real e exige OAuth do criador, e a stack E2E nao conecta conta Google. Produto correto; teste desatualizado.
- Mode: executor Antigravity (gemini-3.8-flash-high) + judgment pass do orquestrador Claude.

## Owned files

backend/tests/e2e/05-calendar-events.test.ts

## Business-rule gaps

- none

## Log

- 2026-10-14 criado pelo orquestrador.
- 2026-10-14 executor Antigravity (agy 1.3.5, gemini-3.8-flash-high) entregou 0cb222a (base fd8b372), so o arquivo de teste.
- 2026-10-14 judgment pass (orquestrador Claude): revisado contra calendarController.ts:111-112 (resposta {total, synced}) e gcalService.ts NOT_CONNECTED_MESSAGE. Checkout limpo 0cb222a: npm run test:e2e exit 0, 19/19. Verdict: ship.

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-6ea081-tc-e2e-05-desatualizado-apos-sync-real-do-google.json
