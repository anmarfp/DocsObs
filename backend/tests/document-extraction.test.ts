import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { Role, DocumentStatus, AuditAction } from '@prisma/client';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';
import { UPLOADS_DIR } from '../src/services/storageService.js';

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  const env = { ...actual.env, EXTRACTION_SERVICE_URL: 'http://localhost:8000', EXTRACTION_TIMEOUT_MS: 5000 };
  return { ...actual, env };
});

import { env } from '../src/config/env.js';

// Mock do Prisma
vi.mock('../src/lib/prisma.js', () => {
  const mockPrisma: any = {
    user: {
      findUnique: vi.fn(),
    },
    companyConfig: {
      findFirst: vi.fn().mockResolvedValue({ notificationMode: 'ALL_ADMINS' }),
    },
    documentCategory: {
      findUnique: vi.fn(),
    },
    document: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) =>
      typeof callback === 'function' ? callback(mockPrisma) : Promise.all(callback)
    ),
  };
  return { prisma: mockPrisma };
});

import { prisma } from '../src/lib/prisma.js';

describe('Suíte de Integração do Serviço de Extração de Documentos', () => {
  const authToken = generateToken({
    userId: 'user-uuid-1',
    email: 'user@docsobs.com.br',
    name: 'Operador Teste',
    role: Role.OPERATIONAL,
  });

  const validCategoryId = 'c0000000-0000-0000-0000-000000000001';

  // Magic bytes válidos de PDF (%PDF-)
  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  // Magic bytes válidos de PNG
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  // Magic bytes inválidos (texto puro)
  const invalidBuffer = Buffer.from('Texto puro sem cabecalho de formato suportado');

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).EXTRACTION_SERVICE_URL = 'http://localhost:8000';
    (env as any).EXTRACTION_TIMEOUT_MS = 5000;

    (prisma.documentCategory.findUnique as any).mockResolvedValue({
      id: validCategoryId,
      name: 'Fiscal',
    });
  });

  describe('POST /api/v1/documents/extract', () => {
    it('responde 503 quando EXTRACTION_SERVICE_URL não está configurada', async () => {
      (env as any).EXTRACTION_SERVICE_URL = undefined;

      const res = await request(app)
        .post('/api/v1/documents/extract')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('attachment', validPdfBuffer, 'documento.pdf');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ message: 'Serviço de extração indisponível' });
    });

    it('responde 503 em caso de timeout ou falha de rede ao conectar no serviço Python', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Connect ECONNREFUSED 127.0.0.1:8000'));

      try {
        const res = await request(app)
          .post('/api/v1/documents/extract')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('attachment', validPdfBuffer, 'documento.pdf');

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ message: 'Serviço de extração indisponível' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('responde 503 quando o serviço de extração devolve HTTP 500 ou resposta inválida', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Falha interna do motor OCR' }),
      } as any);

      try {
        const res = await request(app)
          .post('/api/v1/documents/extract')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('attachment', validPdfBuffer, 'documento.pdf');

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ message: 'Serviço de extração indisponível' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('retorna 200 com mapeamento correto (engine, engineVersion e fields) em caso de sucesso', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          engine: 'tesseract',
          engine_version: '5.3.0',
          elapsed_s: 1.25,
          fields: {
            issueDate: { value: '2026-03-15', confidence: 0.95 },
            expirationDate: { value: null, confidence: 0.0 },
            issuingBody: { value: 'Receita Federal do Brasil', confidence: 0.88 },
          },
        }),
      } as any);

      try {
        const res = await request(app)
          .post('/api/v1/documents/extract')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('attachment', validPdfBuffer, 'documento.pdf');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          engine: 'tesseract',
          engineVersion: '5.3.0',
          fields: {
            issueDate: { value: '2026-03-15', confidence: 0.95 },
            expirationDate: { value: null, confidence: 0.0 },
            issuingBody: { value: 'Receita Federal do Brasil', confidence: 0.88 },
          },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejeita arquivo com tipo inválido pelos magic bytes (400)', async () => {
      const res = await request(app)
        .post('/api/v1/documents/extract')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('attachment', invalidBuffer, {
          filename: 'falso.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
    });

    it('rejeita requisição sem arquivo anexo (400)', async () => {
      const res = await request(app)
        .post('/api/v1/documents/extract')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
    });

    it('não grava nada no diretório de uploads durante a rota de extração', async () => {
      const filesBefore = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          engine: 'tesseract',
          engine_version: '5.3.0',
          fields: {
            issueDate: { value: '2026-01-01', confidence: 0.9 },
            expirationDate: { value: null, confidence: 0.0 },
            issuingBody: { value: null, confidence: 0.0 },
          },
        }),
      } as any);

      try {
        await request(app)
          .post('/api/v1/documents/extract')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('attachment', validPdfBuffer, 'teste-memoria.pdf');

        const filesAfter = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];
        expect(filesAfter.length).toBe(filesBefore.length);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('POST /api/v1/documents (criação com sugestões e auditoria)', () => {
    const sampleSuggestions = {
      engine: 'tesseract',
      fields: {
        issueDate: { value: '2026-02-10', confidence: 0.95 },
        expirationDate: { value: '2026-08-10', confidence: 0.91 },
        issuingBody: { value: 'Receita Federal', confidence: 0.85 },
      },
    };

    it('retorna 400 quando há extractionSuggestions mas extractionConfirmed não é "true"', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Alvará Municipal')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-02-10')
        .field('expirationDate', '2026-08-10')
        .field('issuingBody', 'Receita Federal')
        .field('extractionSuggestions', JSON.stringify(sampleSuggestions));
      // extractionConfirmed não enviado

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EXTRACTION_CONFIRMATION_REQUIRED');
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('registra fieldOrigins AUTO/MANUAL corretos e extraction no audit_logs quando confirmado', async () => {
      let createdDocData: any = null;
      let auditLogData: any = null;

      (prisma.document.create as any).mockImplementation(({ data }: any) => {
        createdDocData = {
          id: 'doc-ext-001',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return Promise.resolve(createdDocData);
      });

      (prisma.auditLog.create as any).mockImplementation(({ data }: any) => {
        auditLogData = data;
        return Promise.resolve({ id: 'audit-001', ...data });
      });

      // issueDate e issuingBody mantidos iguais à sugestão (AUTO)
      // expirationDate editado manualmente pelo usuário para data diferente (MANUAL)
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Certidão com Origens Mistas')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-02-10') // Igual à sugestão -> AUTO
        .field('expirationDate', '2026-12-31') // Diferente de 2026-08-10 -> MANUAL
        .field('issuingBody', 'Receita Federal') // Igual -> AUTO
        .field('extractionSuggestions', JSON.stringify(sampleSuggestions))
        .field('extractionConfirmed', 'true');

      expect(res.status).toBe(201);
      expect(auditLogData).toBeDefined();
      expect(auditLogData.action).toBe(AuditAction.CREATE);

      const diff = auditLogData.diffData;
      expect(diff.fieldOrigins).toEqual({
        issueDate: 'AUTO',
        expirationDate: 'MANUAL',
        issuingBody: 'AUTO',
      });

      expect(diff.extraction).toEqual({
        engine: 'tesseract',
        confidence: {
          issueDate: 0.95,
          expirationDate: 0.91,
          issuingBody: 0.85,
        },
      });
    });

    it('classifica campo como MANUAL quando a sugestão original era nula (sem sugestão)', async () => {
      let auditLogData: any = null;

      const suggestionsWithNull = {
        engine: 'tesseract',
        fields: {
          issueDate: { value: '2026-02-10', confidence: 0.95 },
          expirationDate: { value: null, confidence: 0.0 }, // Sem sugestão
          issuingBody: { value: null, confidence: 0.0 },
        },
      };

      (prisma.document.create as any).mockImplementation(({ data }: any) => {
        return Promise.resolve({
          id: 'doc-ext-002',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      (prisma.auditLog.create as any).mockImplementation(({ data }: any) => {
        auditLogData = data;
        return Promise.resolve({ id: 'audit-002', ...data });
      });

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Certidão sem Vencimento Sugerido')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-02-10')
        .field('issuingBody', 'Prefeitura de Curitiba')
        .field('extractionSuggestions', JSON.stringify(suggestionsWithNull))
        .field('extractionConfirmed', 'true');

      expect(res.status).toBe(201);
      expect(auditLogData.diffData.fieldOrigins).toEqual({
        issueDate: 'AUTO',
        expirationDate: 'MANUAL',
        issuingBody: 'MANUAL',
      });
    });

    it('mantém o diffData e comportamento inalterados quando não há sugestões de extração', async () => {
      let auditLogData: any = null;

      (prisma.document.create as any).mockImplementation(({ data }: any) => {
        return Promise.resolve({
          id: 'doc-ext-003',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      (prisma.auditLog.create as any).mockImplementation(({ data }: any) => {
        auditLogData = data;
        return Promise.resolve({ id: 'audit-003', ...data });
      });

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .field('title', 'Cadastro Manual Tradicional')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-15')
        .field('expirationDate', '2026-07-15')
        .field('issuingBody', 'Tribunal Superior do Trabalho');

      expect(res.status).toBe(201);
      expect(auditLogData.diffData).not.toHaveProperty('fieldOrigins');
      expect(auditLogData.diffData).not.toHaveProperty('extraction');
      expect(auditLogData.diffData).toHaveProperty('title');
      expect(auditLogData.diffData).toHaveProperty('issueDate');
    });
  });
});
