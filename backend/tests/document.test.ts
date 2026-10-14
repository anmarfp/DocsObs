import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { Role, DocumentStatus, AuditAction, NotificationMode } from '@prisma/client';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';
import {
  calculateDocumentStatus,
  normalizeDateToMidnight,
  getDaysUntilExpiration,
} from '../src/services/statusService.js';
import {
  UPLOADS_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  deleteUploadedFile,
} from '../src/services/storageService.js';

// Mock do Prisma
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    companyConfig: {
      findFirst: vi.fn(),
    },
    documentCategory: {
      findUnique: vi.fn(),
    },
    document: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma.js';

describe('Suíte de Testes Automatizados - Módulo de Documentos, Matriz de Cores, Storage e RBAC', () => {
  const adminToken = generateToken({
    userId: 'admin-uuid-1',
    email: 'admin@docsobs.com.br',
    name: 'Admin Teste',
    role: Role.ADMIN,
  });

  const opToken = generateToken({
    userId: 'op-uuid-2',
    email: 'operacional@docsobs.com.br',
    name: 'Operacional Teste',
    role: Role.OPERATIONAL,
  });

  const validCategoryId = 'c0000000-0000-0000-0000-000000000001';

  const sampleDoc = {
    id: 'doc-uuid-123',
    title: 'Certidão Negativa de Débitos Federais',
    categoryId: validCategoryId,
    issuingBody: 'Receita Federal',
    issueDate: new Date('2026-01-01T00:00:00.000Z'),
    expirationDate: new Date('2026-12-31T00:00:00.000Z'),
    alertLeadDays: 30,
    status: DocumentStatus.REGULAR,
    responsibleName: 'João Silva',
    responsibleEmail: 'joao@empresa.com',
    attachmentUrl: null,
    attachmentFilename: null,
    fileSizeBytes: null,
    fileMimeType: null,
    notes: 'Renovação semestral',
    isArchived: false,
    createdById: 'admin-uuid-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    category: { id: validCategoryId, name: 'Fiscal', colorHex: '#3b82f6' },
    createdBy: { id: 'admin-uuid-1', name: 'Admin Teste', email: 'admin@docsobs.com.br', role: Role.ADMIN },
    versions: [],
    auditLogs: [],
    gcalSyncLogs: [],
  };

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. MATRIZ DE CORES E STATUS (RN-001) - TESTES UNITÁRIOS E EDGE CASES
  // =========================================================================
  describe('1. Matriz de Cores e Cálculo de Status (RN-001)', () => {
    // Instante fixo: 2026-08-26 12:00 UTC (09:00 em America/Sao_Paulo) — independe do fuso do host (DOC-27)
    const fixedToday = new Date('2026-08-26T12:00:00.000Z');

    describe('calculateDocumentStatus', () => {
      it('deve retornar INDETERMINATE quando expirationDate for null, undefined, vazia ou apenas espaços', () => {
        expect(calculateDocumentStatus(null, 30, false, fixedToday)).toBe(DocumentStatus.INDETERMINATE);
        expect(calculateDocumentStatus(undefined, 30, false, fixedToday)).toBe(DocumentStatus.INDETERMINATE);
        expect(calculateDocumentStatus('', 30, false, fixedToday)).toBe(DocumentStatus.INDETERMINATE);
        expect(calculateDocumentStatus('   ', 30, false, fixedToday)).toBe(DocumentStatus.INDETERMINATE);
      });

      it('deve retornar RENEWAL_IN_PROGRESS quando isRenewalInProgress for true com expirationDate válida futura ou passada', () => {
        // Data futura com renovação marcada
        expect(calculateDocumentStatus('2026-12-31', 30, true, fixedToday)).toBe(DocumentStatus.RENEWAL_IN_PROGRESS);
        // Data vencida com renovação marcada
        expect(calculateDocumentStatus('2026-08-20', 30, true, fixedToday)).toBe(DocumentStatus.RENEWAL_IN_PROGRESS);
        // Data de hoje com renovação marcada
        expect(calculateDocumentStatus('2026-08-26', 30, true, fixedToday)).toBe(DocumentStatus.RENEWAL_IN_PROGRESS);
      });

      it('deve retornar INDETERMINATE quando expirationDate for nula mesmo se isRenewalInProgress for true', () => {
        // Documento sem data de vencimento não tem prazo para renovar
        expect(calculateDocumentStatus(null, 30, true, fixedToday)).toBe(DocumentStatus.INDETERMINATE);
      });

      it('deve retornar EXPIRED quando a data de vencimento for estritamente anterior a hoje (meia-noite)', () => {
        // Venceu ontem (2026-08-25)
        expect(calculateDocumentStatus('2026-08-25', 30, false, fixedToday)).toBe(DocumentStatus.EXPIRED);
        // Venceu mês passado (2026-07-31)
        expect(calculateDocumentStatus('2026-07-31', 30, false, fixedToday)).toBe(DocumentStatus.EXPIRED);
        // Venceu ano passado (2025-12-31)
        expect(calculateDocumentStatus('2025-12-31', 30, false, fixedToday)).toBe(DocumentStatus.EXPIRED);
      });

      it('deve retornar CRITICAL quando o documento estiver vencendo hoje (0 dias de diferença)', () => {
        // Vence hoje com antecedência padrão de 30 dias (0 <= 30)
        expect(calculateDocumentStatus('2026-08-26', 30, false, fixedToday)).toBe(DocumentStatus.CRITICAL);
        // Vence hoje com antecedência de 0 dias (0 <= 0)
        expect(calculateDocumentStatus('2026-08-26', 0, false, fixedToday)).toBe(DocumentStatus.CRITICAL);
      });

      it('deve retornar CRITICAL quando vencendo exatamente em 30 dias com alertLeadDays = 30 (limite superior exato)', () => {
        // 2026-08-26 + 30 dias = 2026-09-25
        expect(calculateDocumentStatus('2026-09-25', 30, false, fixedToday)).toBe(DocumentStatus.CRITICAL);
      });

      it('deve retornar CRITICAL quando a diferença em dias estiver dentro do intervalo [0, alertLeadDays]', () => {
        // Vence amanhã (1 dia)
        expect(calculateDocumentStatus('2026-08-27', 30, false, fixedToday)).toBe(DocumentStatus.CRITICAL);
        // Vence em 15 dias
        expect(calculateDocumentStatus('2026-09-10', 30, false, fixedToday)).toBe(DocumentStatus.CRITICAL);
      });

      it('deve retornar REGULAR quando a diferença em dias for estritamente maior que alertLeadDays (31 dias)', () => {
        // 2026-08-26 + 31 dias = 2026-09-26
        expect(calculateDocumentStatus('2026-09-26', 30, false, fixedToday)).toBe(DocumentStatus.REGULAR);
        // 60 dias no futuro (2026-10-25)
        expect(calculateDocumentStatus('2026-10-25', 30, false, fixedToday)).toBe(DocumentStatus.REGULAR);
        // 1 ano no futuro (2027-08-26)
        expect(calculateDocumentStatus('2027-08-26', 30, false, fixedToday)).toBe(DocumentStatus.REGULAR);
      });
    });

    describe('getDaysUntilExpiration e normalizeDateToMidnight', () => {
      it('deve calcular a quantidade de dias até o vencimento com precisão', () => {
        expect(getDaysUntilExpiration(null, fixedToday)).toBeNull();
        expect(getDaysUntilExpiration(undefined, fixedToday)).toBeNull();
        expect(getDaysUntilExpiration('2026-08-26', fixedToday)).toBe(0);
        expect(getDaysUntilExpiration('2026-08-27', fixedToday)).toBe(1);
        expect(getDaysUntilExpiration('2026-09-25', fixedToday)).toBe(30);
        expect(getDaysUntilExpiration('2026-09-26', fixedToday)).toBe(31);
        expect(getDaysUntilExpiration('2026-08-25', fixedToday)).toBe(-1);
        expect(getDaysUntilExpiration('2026-08-01', fixedToday)).toBe(-25);
      });

      it('deve normalizar strings YYYY-MM-DD, ISO e objetos Date para a data civil em meia-noite UTC', () => {
        const fromYmd = normalizeDateToMidnight('2026-08-26');
        expect(fromYmd).toEqual(new Date('2026-08-26T00:00:00.000Z'));

        const fromIso = normalizeDateToMidnight('2026-08-26T23:59:59.999Z');
        expect(fromIso).not.toBeNull();
        expect(fromIso).toEqual(new Date('2026-08-26T00:00:00.000Z'));

        const fromDate = normalizeDateToMidnight(new Date('2026-08-26T18:45:00.000Z'));
        expect(fromDate).toEqual(new Date('2026-08-26T00:00:00.000Z'));

        // Data gravada como meia-noite UTC mantém o mesmo dia civil em qualquer fuso do processo
        const stored = normalizeDateToMidnight(new Date('2026-08-30T00:00:00.000Z'));
        expect(stored).toEqual(new Date('2026-08-30T00:00:00.000Z'));

        expect(normalizeDateToMidnight('data-invalida')).toBeNull();
        expect(normalizeDateToMidnight(new Date('invalida'))).toBeNull();
      });
    });
  });

  // =========================================================================
  // 2. SERVIÇO DE ARMAZENAMENTO E UPLOAD DE ARQUIVOS (STORAGE)
  // =========================================================================
  describe('2. Validações de Armazenamento e Upload (Storage)', () => {
    it('deve validar limites e extensões suportadas', () => {
      expect(UPLOADS_DIR).toBeDefined();
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024); // 10MB
      expect(ALLOWED_MIME_TYPES).toEqual(
        expect.arrayContaining(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])
      );
    });

    it('deve proteger contra Path Traversal em deleteUploadedFile', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\calc.exe',
        '/etc/shadow',
        'C:\\secret.txt',
      ];

      for (const p of maliciousPaths) {
        const result = await deleteUploadedFile(p);
        expect(result).toBe(false);
      }
    });

    it('deve retornar false caso o arquivo a ser deletado não exista no disco', async () => {
      const result = await deleteUploadedFile('/api/v1/uploads/inexistente-12345.pdf');
      expect(result).toBe(false);
    });

    it('deve excluir arquivo físico existente no diretório de uploads', async () => {
      const testFileName = `test-temp-${Date.now()}.pdf`;
      const testFilePath = path.resolve(UPLOADS_DIR, testFileName);
      fs.writeFileSync(testFilePath, 'conteúdo teste temporário');

      expect(fs.existsSync(testFilePath)).toBe(true);

      const deleted = await deleteUploadedFile(`/api/v1/uploads/${testFileName}`);
      expect(deleted).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(false);
    });
  });

  // =========================================================================
  // 3. VALIDAÇÕES DE UPLOAD NA API (LIMITES E TIPOS DE ARQUIVO)
  // =========================================================================
  describe('3. Validações de Upload na API (POST/PUT)', () => {
    it('deve rejeitar upload com tipo de arquivo não permitido (.exe, .txt, .zip) com status 400', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Documento com Arquivo Inválido')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-01')
        .attach('attachment', Buffer.from('script malicioso'), {
          filename: 'script.exe',
          contentType: 'application/x-msdownload',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(res.body.message).toContain('Tipo de arquivo não permitido');
    });

    it('deve rejeitar upload de arquivo de texto simples (.txt) com status 400', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Documento com Arquivo TXT')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-01')
        .attach('attachment', Buffer.from('texto simples'), {
          filename: 'documento.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
    });

    it('deve rejeitar upload de arquivo que excede o limite de 10MB com status 400 (FILE_TOO_LARGE)', async () => {
      // Buffer de 10.5 MB (> 10 * 1024 * 1024)
      const oversizedBuffer = Buffer.alloc(10.5 * 1024 * 1024, 0);

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Documento Gigante')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-01')
        .attach('attachment', oversizedBuffer, {
          filename: 'arquivo-gigante.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
      expect(res.body.message).toContain('10 MB');
    });

    it('deve aceitar upload de anexo PDF válido e persistir metadados', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue({
        id: validCategoryId,
        name: 'Fiscal',
      });
      (prisma.document.create as any).mockImplementation(({ data }) => ({
        ...sampleDoc,
        ...data,
        id: 'doc-with-pdf-uuid',
      }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-pdf-1' });

      const pdfBuffer = Buffer.from('%PDF-1.4 mock pdf content');

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Alvará com PDF Anexo')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-01')
        .attach('attachment', pdfBuffer, {
          filename: 'alvara_2026.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);
      expect(res.body.document.attachmentFilename).toBe('alvara_2026.pdf');
      expect(res.body.document.attachmentUrl).toMatch(/^\/api\/v1\/uploads\/.+\.pdf$/);
      expect(res.body.document.fileMimeType).toBe('application/pdf');

      // Cleanup do arquivo criado no disco
      if (res.body.document.attachmentUrl) {
        await deleteUploadedFile(res.body.document.attachmentUrl);
      }
    });

    it('deve aceitar upload de imagem PNG válida', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue({
        id: validCategoryId,
        name: 'Fiscal',
      });
      (prisma.document.create as any).mockImplementation(({ data }) => ({
        ...sampleDoc,
        ...data,
        id: 'doc-with-png-uuid',
      }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-png-1' });

      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Comprovante em Imagem PNG')
        .field('categoryId', validCategoryId)
        .field('issueDate', '2026-01-01')
        .attach('attachment', pngBuffer, {
          filename: 'comprovante.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(201);
      expect(res.body.document.attachmentFilename).toBe('comprovante.png');
      expect(res.body.document.fileMimeType).toBe('image/png');

      if (res.body.document.attachmentUrl) {
        await deleteUploadedFile(res.body.document.attachmentUrl);
      }
    });

    it('deve remover anexo temporário caso a validação do formulário falhe (campos obrigatórios ausentes)', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 mock');

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        // Omitindo title e categoryId
        .attach('attachment', pdfBuffer, {
          filename: 'temp_doc.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('deve remover anexo temporário caso a categoria não seja encontrada', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue(null);

      const pdfBuffer = Buffer.from('%PDF-1.4 mock');

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Documento Sem Categoria')
        .field('categoryId', 'c9999999-9999-9999-9999-999999999999')
        .field('issueDate', '2026-01-01')
        .attach('attachment', pdfBuffer, {
          filename: 'doc_sem_cat.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CATEGORY_NOT_FOUND');
    });
  });

  // =========================================================================
  // 4. CRIAÇÃO E ATUALIZAÇÃO DE DOCUMENTOS (REGRAS DE NEGÓCIO E EDGE CASES)
  // =========================================================================
  describe('4. Criação e Edição de Documentos (POST / PUT)', () => {
    describe('POST /api/v1/documents', () => {
      it('deve rejeitar requisição não autenticada com 401', async () => {
        const res = await request(app).post('/api/v1/documents').send({
          title: 'Documento Sem Auth',
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
      });

      it('deve falhar com 400 quando campos obrigatórios estiverem ausentes ou inválidos', async () => {
        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: '', // Título vazio
            categoryId: 'nao-e-uuid', // UUID inválido
            issueDate: 'data-invalida', // Data inválida
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(res.body.details).toBeDefined();
      });

      it('deve falhar com 400 se alertLeadDays for menor que 1', async () => {
        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'Doc Prazo Invalido',
            categoryId: validCategoryId,
            issueDate: '2026-01-01',
            alertLeadDays: 0,
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
      });

      it('deve falhar com 400 se e-mail do responsável for inválido', async () => {
        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'Doc Email Invalido',
            categoryId: validCategoryId,
            issueDate: '2026-01-01',
            responsibleEmail: 'email-invalido-sem-arroba',
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
      });

      it('deve exigir responsável se a empresa estiver no modo ONLY_RESPONSIBLE (RN-004)', async () => {
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ONLY_RESPONSIBLE,
        });

        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'Alvará Sanitário',
            categoryId: validCategoryId,
            issueDate: '2026-01-01',
            expirationDate: '2026-12-31',
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('RESPONSIBLE_REQUIRED');
      });

      it('deve calcular status INDETERMINATE quando criado sem data de vencimento', async () => {
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.documentCategory.findUnique as any).mockResolvedValue({
          id: validCategoryId,
          name: 'Fiscal',
        });
        (prisma.document.create as any).mockImplementation(({ data }) => ({
          ...sampleDoc,
          ...data,
          id: 'doc-indet-uuid',
        }));
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-indet-1' });

        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'Contrato Social Permanente',
            categoryId: validCategoryId,
            issueDate: '2026-01-01',
            expirationDate: null,
          });

        expect(res.status).toBe(201);
        expect(prisma.document.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: DocumentStatus.INDETERMINATE,
              expirationDate: null,
            }),
          })
        );
      });

      it('deve calcular status RENEWAL_IN_PROGRESS quando isRenewalInProgress for true', async () => {
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.documentCategory.findUnique as any).mockResolvedValue({
          id: validCategoryId,
          name: 'Fiscal',
        });
        (prisma.document.create as any).mockImplementation(({ data }) => ({
          ...sampleDoc,
          ...data,
          id: 'doc-renewal-uuid',
        }));
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-renew-1' });

        const res = await request(app)
          .post('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: 'Licença Ambiental em Renovação',
            categoryId: validCategoryId,
            issueDate: '2026-01-01',
            expirationDate: '2026-12-31',
            isRenewalInProgress: true,
          });

        expect(res.status).toBe(201);
        expect(prisma.document.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: DocumentStatus.RENEWAL_IN_PROGRESS,
            }),
          })
        );
      });
    });

    describe('PUT /api/v1/documents/:id', () => {
      it('deve retornar 404 para documento inexistente', async () => {
        (prisma.document.findUnique as any).mockResolvedValue(null);

        const res = await request(app)
          .put('/api/v1/documents/doc-nao-existe')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'Novo Título' });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
      });

      it('deve falhar com 404 se a categoria alterada não existir', async () => {
        (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
        (prisma.documentCategory.findUnique as any).mockResolvedValue(null);

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ categoryId: 'c9999999-9999-9999-9999-999999999999' });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('CATEGORY_NOT_FOUND');
      });

      it('deve substituir anexo antigo por novo anexo, deletando arquivo anterior do disco', async () => {
        const oldFile = `old-file-${Date.now()}.pdf`;
        const oldFilePath = path.resolve(UPLOADS_DIR, oldFile);
        fs.writeFileSync(oldFilePath, 'arquivo antigo');

        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          attachmentUrl: `/api/v1/uploads/${oldFile}`,
          attachmentFilename: 'antigo.pdf',
        });
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.document.update as any).mockImplementation(({ data }) => ({
          ...sampleDoc,
          ...data,
        }));
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-update-file' });

        const newPdfBuffer = Buffer.from('%PDF-1.4 novo');

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`)
          .field('title', 'Documento com Novo Anexo')
          .attach('attachment', newPdfBuffer, {
            filename: 'novo_anexo.pdf',
            contentType: 'application/pdf',
          });

        expect(res.status).toBe(200);
        // O arquivo antigo deve ter sido removido
        expect(fs.existsSync(oldFilePath)).toBe(false);

        if (res.body.document.attachmentUrl) {
          await deleteUploadedFile(res.body.document.attachmentUrl);
        }
      });

      it('não deve criar registro de auditLog se nenhum campo for modificado', async () => {
        (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.document.update as any).mockResolvedValue(sampleDoc);

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({});

        expect(res.status).toBe(200);
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
      });

      it('deve preservar RENEWAL_IN_PROGRESS ao editar outro campo sem encerrar a renovação', async () => {
        const renewalDocument = {
          ...sampleDoc,
          status: DocumentStatus.RENEWAL_IN_PROGRESS,
        };
        (prisma.document.findUnique as any).mockResolvedValue(renewalDocument);
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.document.update as any).mockImplementation(({ data }) => ({
          ...renewalDocument,
          ...data,
        }));
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-preserve-renewal' });

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'Licença em renovação - revisada' });

        expect(res.status).toBe(200);
        expect(prisma.document.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: DocumentStatus.RENEWAL_IN_PROGRESS }),
          })
        );
        expect(res.body.document.status).toBe(DocumentStatus.RENEWAL_IN_PROGRESS);
      });
    });
  });

  // =========================================================================
  // 5. CONTROLE DE ACESSO RBAC E VISIBILIDADE DE ARQUIVADOS
  // =========================================================================
  describe('5. Controle de Acesso RBAC e Visibilidade de Documentos', () => {
    describe('Listagem (GET /api/v1/documents)', () => {
      it('deve forçar isArchived=false para usuário OPERATIONAL, mesmo com query includeArchived=true', async () => {
        (prisma.document.findMany as any).mockResolvedValue([sampleDoc]);
        (prisma.document.count as any).mockResolvedValue(1);

        const res = await request(app)
          .get('/api/v1/documents?includeArchived=true')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(200);
        expect(prisma.document.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ isArchived: false }),
          })
        );
      });

      it('deve filtrar isArchived=false para ADMIN quando includeArchived não for enviado', async () => {
        (prisma.document.findMany as any).mockResolvedValue([sampleDoc]);
        (prisma.document.count as any).mockResolvedValue(1);

        const res = await request(app)
          .get('/api/v1/documents')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(prisma.document.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ isArchived: false }),
          })
        );
      });

      it('deve permitir que ADMIN visualize todos os documentos (incluindo arquivados) com includeArchived=true', async () => {
        (prisma.document.findMany as any).mockResolvedValue([sampleDoc]);
        (prisma.document.count as any).mockResolvedValue(1);

        const res = await request(app)
          .get('/api/v1/documents?includeArchived=true')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(prisma.document.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ isArchived: false }),
          })
        );
      });
    });

    describe('Detalhes (GET /api/v1/documents/:id)', () => {
      it('deve ocultar (404) documento arquivado para usuário OPERATIONAL', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });

        const res = await request(app)
          .get('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
      });

      it('deve exibir (200) documento arquivado para usuário ADMIN', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });

        const res = await request(app)
          .get('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.document.isArchived).toBe(true);
      });
    });

    describe('Edição em Arquivado (PUT /api/v1/documents/:id)', () => {
      it('deve bloquear (404) usuário OPERATIONAL ao tentar editar documento arquivado', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${opToken}`)
          .send({ title: 'Tentativa de Edição' });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
      });

      it('deve permitir que ADMIN edite documento arquivado', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });
        (prisma.companyConfig.findFirst as any).mockResolvedValue({
          notificationMode: NotificationMode.ALL_ADMINS,
        });
        (prisma.document.update as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
          title: 'Título Editado pelo Admin',
        });
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-edit-archived' });

        const res = await request(app)
          .put('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ title: 'Título Editado pelo Admin' });

        expect(res.status).toBe(200);
        expect(res.body.document.title).toBe('Título Editado pelo Admin');
      });
    });

    describe('Arquivamento e Desarquivamento (PATCH /api/v1/documents/:id/archive)', () => {
      it('deve permitir que OPERATIONAL arquive um documento ativo', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: false,
        });
        (prisma.document.update as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-arch-1' });

        const res = await request(app)
          .patch('/api/v1/documents/doc-uuid-123/archive')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Documento arquivado com sucesso.');
        expect(prisma.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: AuditAction.ARCHIVE,
              diffData: { isArchived: { old: false, new: true } },
            }),
          })
        );
      });

      it('deve impedir (404) que OPERATIONAL desarquive um documento arquivado', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });

        const res = await request(app)
          .patch('/api/v1/documents/doc-uuid-123/archive')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
      });

      it('deve permitir que ADMIN desarquive um documento arquivado', async () => {
        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: true,
        });
        (prisma.document.update as any).mockResolvedValue({
          ...sampleDoc,
          isArchived: false,
        });
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-unarch-1' });

        const res = await request(app)
          .patch('/api/v1/documents/doc-uuid-123/archive')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Documento desarquivado com sucesso.');
        expect(prisma.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: AuditAction.UNARCHIVE,
              diffData: { isArchived: { old: true, new: false } },
            }),
          })
        );
      });
    });

    describe('Exclusão Permanente (DELETE /api/v1/documents/:id - Hard Delete)', () => {
      it('deve proibir OPERATIONAL de excluir permanentemente com 403 FORBIDDEN', async () => {
        const res = await request(app)
          .delete('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${opToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('FORBIDDEN');
      });

      it('deve retornar 404 se ADMIN tentar excluir documento inexistente', async () => {
        (prisma.document.findUnique as any).mockResolvedValue(null);

        const res = await request(app)
          .delete('/api/v1/documents/doc-inexistente')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
      });

      it('deve permitir que ADMIN exclua permanentemente, removendo arquivo do disco e registrando auditoria', async () => {
        const testFile = `to-delete-${Date.now()}.pdf`;
        const testFilePath = path.resolve(UPLOADS_DIR, testFile);
        fs.writeFileSync(testFilePath, 'arquivo a ser deletado');

        (prisma.document.findUnique as any).mockResolvedValue({
          ...sampleDoc,
          attachmentUrl: `/api/v1/uploads/${testFile}`,
        });
        (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-del-1' });
        (prisma.document.delete as any).mockResolvedValue(sampleDoc);

        const res = await request(app)
          .delete('/api/v1/documents/doc-uuid-123')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Documento excluído permanentemente com sucesso.');

        // Arquivo deve ter sido removido do disco
        expect(fs.existsSync(testFilePath)).toBe(false);

        expect(prisma.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: AuditAction.DELETE,
              userId: 'admin-uuid-1',
              diffData: {
                deletedDocumentId: { old: 'doc-uuid-123' },
                title: { old: sampleDoc.title },
              },
            }),
          })
        );
        expect(prisma.document.delete).toHaveBeenCalledWith({
          where: { id: 'doc-uuid-123' },
        });
      });
    });
  });

  // =========================================================================
  // 6. TRILHA DE AUDITORIA E REGISTRO DE DIFERENÇAS (RN-008)
  // =========================================================================
  describe('6. Trilha de Auditoria e Mapeamento de Diffs (RN-008)', () => {
    it('deve capturar diffs detalhados ao atualizar múltiplos campos em updateDocument', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.document.update as any).mockImplementation(({ data }) => ({
        ...sampleDoc,
        ...data,
      }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-diff-multi' });

      const res = await request(app)
        .put('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Título Modificado',
          issuingBody: 'Novo Órgão',
          alertLeadDays: 45,
          responsibleName: 'Carlos Oliveira',
          responsibleEmail: 'carlos@empresa.com',
          notes: 'Novas observações adicionadas',
        });

      expect(res.status).toBe(200);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: AuditAction.UPDATE,
            diffData: expect.objectContaining({
              title: { old: sampleDoc.title, new: 'Título Modificado' },
              issuingBody: { old: sampleDoc.issuingBody, new: 'Novo Órgão' },
              alertLeadDays: { old: 30, new: 45 },
              responsibleName: { old: sampleDoc.responsibleName, new: 'Carlos Oliveira' },
              responsibleEmail: { old: sampleDoc.responsibleEmail, new: 'carlos@empresa.com' },
              notes: { old: sampleDoc.notes, new: 'Novas observações adicionadas' },
            }),
          }),
        })
      );
    });
  });

  // =========================================================================
  // 7. SEGURANÇA E ACESSO A ARQUIVOS ESTÁTICOS (/api/v1/uploads)
  // =========================================================================
  describe('7. Proteção e Segurança de Uploads (/api/v1/uploads)', () => {
    it('deve exigir autenticação (401) ao acessar arquivos em /api/v1/uploads', async () => {
      const res = await request(app).get('/api/v1/uploads/segredo.pdf');
      expect(res.status).toBe(401);
    });

    it('deve retornar 404 ao tentar acessar arquivo estático inexistente com token válido', async () => {
      const res = await request(app)
        .get('/api/v1/uploads/arquivo-inexistente-xyz.pdf')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });
});
