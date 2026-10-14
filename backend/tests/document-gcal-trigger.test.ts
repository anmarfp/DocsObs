import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Role, DocumentStatus, NotificationMode, SyncStatus } from '@prisma/client';

/**
 * DOC-28 (4/5): testa que `documentController.ts` dispara `syncDocumentEvent` /
 * `deleteDocumentEvent` nos pontos certos (criar, editar, arquivar/desarquivar,
 * excluir) e nunca deixa uma falha/rejeição desses mocks virar uma resposta HTTP
 * não-2xx. Segue a instrução da tarefa: mocka `gcalService.js` diretamente em vez
 * de re-testar a lógica interna do serviço (já coberta em
 * `notification-gcal.test.ts`).
 */
vi.mock('../src/services/gcalService.js', () => ({
  syncDocumentEvent: vi.fn(),
  deleteDocumentEvent: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => {
  const mockPrisma: any = {
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
    $transaction: vi.fn(async (callback: any) =>
      typeof callback === 'function' ? callback(mockPrisma) : Promise.all(callback)
    ),
  };
  return { prisma: mockPrisma };
});

import { prisma } from '../src/lib/prisma.js';
import { syncDocumentEvent, deleteDocumentEvent } from '../src/services/gcalService.js';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';

describe('DOC-28 (4/5) - Gatilho automático de sincronização com o Google Agenda (RN-007)', () => {
  const adminToken = generateToken({
    userId: 'admin-uuid-1',
    email: 'admin@docsobs.com.br',
    name: 'Admin Teste',
    role: Role.ADMIN,
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
  };

  const syncedResult = { documentId: sampleDoc.id, gcalEventId: 'gcal-event-1', status: SyncStatus.SYNCED };
  const deletedResult = { documentId: sampleDoc.id, status: SyncStatus.DELETED };

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (syncDocumentEvent as any).mockResolvedValue(syncedResult);
    (deleteDocumentEvent as any).mockResolvedValue(deletedResult);
  });

  // =========================================================================
  // POST /api/v1/documents (createDocument)
  // =========================================================================
  describe('createDocument', () => {
    it('dispara syncDocumentEvent(document, "create") quando o documento é criado com data de vencimento', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue({ id: validCategoryId, name: 'Fiscal' });
      (prisma.document.create as any).mockImplementation(({ data }: any) => ({ ...sampleDoc, ...data }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-1' });

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Alvará Sanitário',
          categoryId: validCategoryId,
          issueDate: '2026-01-01',
          expirationDate: '2026-12-31',
        });

      expect(res.status).toBe(201);
      expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
      expect(syncDocumentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleDoc.id, expirationDate: expect.any(Date) }),
        'create'
      );
      expect(deleteDocumentEvent).not.toHaveBeenCalled();
    });

    it('NÃO dispara syncDocumentEvent quando o documento é criado sem data de vencimento', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue({ id: validCategoryId, name: 'Fiscal' });
      (prisma.document.create as any).mockImplementation(({ data }: any) => ({
        ...sampleDoc,
        ...data,
        expirationDate: null,
      }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-2' });

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
      expect(syncDocumentEvent).not.toHaveBeenCalled();
    });

    it('responde 201 normalmente mesmo quando syncDocumentEvent rejeita (falha de sync não bloqueia a criação)', async () => {
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.documentCategory.findUnique as any).mockResolvedValue({ id: validCategoryId, name: 'Fiscal' });
      (prisma.document.create as any).mockImplementation(({ data }: any) => ({ ...sampleDoc, ...data }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-3' });
      (syncDocumentEvent as any).mockRejectedValue(new Error('Falha simulada de rede'));

      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Licença Ambiental',
          categoryId: validCategoryId,
          issueDate: '2026-01-01',
          expirationDate: '2026-12-31',
        });

      expect(res.status).toBe(201);
      expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // PUT /api/v1/documents/:id (updateDocument)
  // =========================================================================
  describe('updateDocument', () => {
    it('dispara syncDocumentEvent(updatedDocument, "update") quando a data de vencimento é alterada', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.document.update as any).mockImplementation(({ data }: any) => ({ ...sampleDoc, ...data }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-update-1' });

      const res = await request(app)
        .put('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expirationDate: '2027-06-30' });

      expect(res.status).toBe(200);
      expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
      expect(syncDocumentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleDoc.id }),
        'update'
      );
    });

    it('NÃO dispara syncDocumentEvent quando apenas um campo não relacionado (ex.: título) é alterado', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.document.update as any).mockImplementation(({ data }: any) => ({ ...sampleDoc, ...data }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-update-2' });

      const res = await request(app)
        .put('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Novo título sem alterar vencimento' });

      expect(res.status).toBe(200);
      expect(syncDocumentEvent).not.toHaveBeenCalled();
    });

    it('responde 200 normalmente mesmo quando syncDocumentEvent rejeita ao atualizar', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({
        notificationMode: NotificationMode.ALL_ADMINS,
      });
      (prisma.document.update as any).mockImplementation(({ data }: any) => ({ ...sampleDoc, ...data }));
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-update-3' });
      (syncDocumentEvent as any).mockRejectedValue(new Error('Falha simulada de rede'));

      const res = await request(app)
        .put('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expirationDate: '2027-06-30' });

      expect(res.status).toBe(200);
      expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // PATCH /api/v1/documents/:id/archive (toggleArchive)
  // =========================================================================
  describe('toggleArchive', () => {
    it('dispara deleteDocumentEvent ao arquivar um documento ativo', async () => {
      (prisma.document.findUnique as any).mockResolvedValue({ ...sampleDoc, isArchived: false });
      (prisma.document.update as any).mockResolvedValue({ ...sampleDoc, isArchived: true });
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-archive-1' });

      const res = await request(app)
        .patch('/api/v1/documents/doc-uuid-123/archive')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(deleteDocumentEvent).toHaveBeenCalledTimes(1);
      expect(deleteDocumentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleDoc.id, createdById: sampleDoc.createdById })
      );
      expect(syncDocumentEvent).not.toHaveBeenCalled();
    });

    it('dispara syncDocumentEvent ao desarquivar um documento com data de vencimento (recria o evento)', async () => {
      (prisma.document.findUnique as any).mockResolvedValue({ ...sampleDoc, isArchived: true });
      (prisma.document.update as any).mockResolvedValue({ ...sampleDoc, isArchived: false });
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-unarchive-1' });

      const res = await request(app)
        .patch('/api/v1/documents/doc-uuid-123/archive')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
      expect(syncDocumentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleDoc.id }),
        'update'
      );
      expect(deleteDocumentEvent).not.toHaveBeenCalled();
    });

    it('responde 200 normalmente mesmo quando deleteDocumentEvent rejeita ao arquivar', async () => {
      (prisma.document.findUnique as any).mockResolvedValue({ ...sampleDoc, isArchived: false });
      (prisma.document.update as any).mockResolvedValue({ ...sampleDoc, isArchived: true });
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-archive-2' });
      (deleteDocumentEvent as any).mockRejectedValue(new Error('Falha simulada de rede'));

      const res = await request(app)
        .patch('/api/v1/documents/doc-uuid-123/archive')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(deleteDocumentEvent).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // DELETE /api/v1/documents/:id (deleteDocument - hard delete)
  // =========================================================================
  describe('deleteDocument', () => {
    it('chama deleteDocumentEvent ANTES de prisma.document.delete (ordem importa por causa do cascade em GCalSyncLog)', async () => {
      const callOrder: string[] = [];

      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-delete-1' });
      (deleteDocumentEvent as any).mockImplementation(async () => {
        callOrder.push('deleteDocumentEvent');
        return deletedResult;
      });
      (prisma.document.delete as any).mockImplementation(async () => {
        callOrder.push('document.delete');
        return sampleDoc;
      });

      const res = await request(app)
        .delete('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(callOrder).toEqual(['deleteDocumentEvent', 'document.delete']);
      expect(deleteDocumentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleDoc.id, createdById: sampleDoc.createdById })
      );
    });

    it('responde 200 normalmente mesmo quando deleteDocumentEvent rejeita, e ainda assim executa o hard delete', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-delete-2' });
      (deleteDocumentEvent as any).mockRejectedValue(new Error('Falha simulada de rede'));
      (prisma.document.delete as any).mockResolvedValue(sampleDoc);

      const res = await request(app)
        .delete('/api/v1/documents/doc-uuid-123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(deleteDocumentEvent).toHaveBeenCalledTimes(1);
      expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-uuid-123' } });
    });
  });
});
