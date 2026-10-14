import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { Role, DocumentStatus, AuditAction, NotificationMode, SyncStatus } from '@prisma/client';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';
import * as storageService from '../src/services/storageService.js';
import { UPLOADS_DIR } from '../src/services/storageService.js';
import { syncDocumentEvent, deleteDocumentEvent } from '../src/services/gcalService.js';
import { prisma } from '../src/lib/prisma.js';

vi.mock('../src/services/gcalService.js', () => ({
  syncDocumentEvent: vi.fn(),
  deleteDocumentEvent: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => {
  const mockTx: any = {
    document: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documentVersion: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  const mockPrisma: any = {
    user: { findUnique: vi.fn() },
    companyConfig: { findFirst: vi.fn() },
    documentCategory: { findUnique: vi.fn() },
    document: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    documentVersion: {
      aggregate: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => {
      if (typeof cb === 'function') {
        return cb(mockTx);
      }
      return Promise.all(cb);
    }),
    __mockTx: mockTx,
  };

  return { prisma: mockPrisma };
});

describe('DOC-37: Transações nas escritas de documentos e versão única por documento', () => {
  const adminToken = generateToken({
    userId: 'admin-uuid-1',
    email: 'admin@docsobs.com.br',
    name: 'Admin Teste',
    role: Role.ADMIN,
  });

  const validCategoryId = 'c0000000-0000-0000-0000-000000000001';

  const sampleDoc = {
    id: 'doc-uuid-123',
    title: 'Alvará Sanitário',
    categoryId: validCategoryId,
    issuingBody: 'Vigilância Sanitária',
    issueDate: new Date('2026-01-01T00:00:00.000Z'),
    expirationDate: new Date('2026-12-31T00:00:00.000Z'),
    alertLeadDays: 30,
    status: DocumentStatus.REGULAR,
    responsibleName: 'Maria Silva',
    responsibleEmail: 'maria@docsobs.com.br',
    attachmentUrl: null,
    attachmentFilename: null,
    fileSizeBytes: null,
    fileMimeType: null,
    notes: 'Alvará regular',
    isArchived: false,
    createdById: 'admin-uuid-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    category: { id: validCategoryId, name: 'Fiscal', colorHex: '#3b82f6' },
    createdBy: { id: 'admin-uuid-1', name: 'Admin Teste', email: 'admin@docsobs.com.br', role: Role.ADMIN },
    versions: [],
  };

  const getMockTx = () => (prisma as any).__mockTx;

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const mockTx = getMockTx();
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') {
        return cb(mockTx);
      }
      return Promise.all(cb);
    });
    (syncDocumentEvent as any).mockResolvedValue({ status: SyncStatus.SYNCED });
    (deleteDocumentEvent as any).mockResolvedValue({ status: SyncStatus.DELETED });
  });

  // =========================================================================
  // Caso 1: renewal: tx.document.update throws
  // =========================================================================
  it('renewal: tx.document.update throws -> no 2xx, tx rejected, new uploaded file deleted, old attachment NOT deleted, no Google sync', async () => {
    const mockTx = getMockTx();
    const oldFileName = `old-renew-fail-${Date.now()}.pdf`;
    const oldFilePath = path.resolve(UPLOADS_DIR, oldFileName);
    fs.writeFileSync(oldFilePath, 'conteudo antigo');

    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: `/api/v1/uploads/${oldFileName}`,
      attachmentFilename: 'antigo.pdf',
    });
    mockTx.documentVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 1 } });
    mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });
    mockTx.document.update.mockRejectedValue(new Error('Erro simulado ao atualizar documento na transação'));

    const deleteSpy = vi.spyOn(storageService, 'deleteUploadedFile');

    const res = await request(app)
      .post(`/api/v1/documents/${sampleDoc.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('issueDate', '2026-02-01')
      .field('expirationDate', '2027-02-01')
      .attach('attachment', Buffer.from('%PDF-1.4 novo arquivo'), {
        filename: 'novo.pdf',
        contentType: 'application/pdf',
      });

    // 1. Resposta não é 2xx
    expect(res.status).toBe(500);

    // 2. Anexo antigo NÃO foi deletado do disco e deleteUploadedFile só removeu o novo arquivo
    expect(fs.existsSync(oldFilePath)).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalledWith(`/api/v1/uploads/${oldFileName}`);
    expect(deleteSpy).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/));

    // 3. Nenhum sync com o Google Agenda foi chamado
    expect(syncDocumentEvent).not.toHaveBeenCalled();

    // Limpeza
    if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  });

  // =========================================================================
  // Caso 2: renewal: tx.auditLog.create throws
  // =========================================================================
  it('renewal: tx.auditLog.create throws -> no 2xx, tx rejected, new uploaded file deleted, old attachment NOT deleted, no Google sync', async () => {
    const mockTx = getMockTx();
    const oldFileName = `old-renew-audit-fail-${Date.now()}.pdf`;
    const oldFilePath = path.resolve(UPLOADS_DIR, oldFileName);
    fs.writeFileSync(oldFilePath, 'conteudo antigo');

    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: `/api/v1/uploads/${oldFileName}`,
      attachmentFilename: 'antigo.pdf',
    });
    mockTx.documentVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 1 } });
    mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });
    mockTx.document.update.mockResolvedValue({
      ...sampleDoc,
      issueDate: new Date('2026-02-01'),
      expirationDate: new Date('2027-02-01'),
    });
    mockTx.auditLog.create.mockRejectedValue(new Error('Erro simulado ao gravar auditLog na renovação'));

    const deleteSpy = vi.spyOn(storageService, 'deleteUploadedFile');

    const res = await request(app)
      .post(`/api/v1/documents/${sampleDoc.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('issueDate', '2026-02-01')
      .field('expirationDate', '2027-02-01')
      .attach('attachment', Buffer.from('%PDF-1.4 novo anexo audit fail'), {
        filename: 'novo.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(500);
    expect(fs.existsSync(oldFilePath)).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalledWith(`/api/v1/uploads/${oldFileName}`);
    expect(deleteSpy).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/));
    expect(syncDocumentEvent).not.toHaveBeenCalled();

    if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  });

  // =========================================================================
  // Caso 3: renewal: first attempt throws P2002 then succeeds
  // =========================================================================
  it('renewal: first attempt throws P2002 then succeeds -> 2xx, versionNumber from second attempt, no Google sync', async () => {
    const mockTx = getMockTx();
    (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);

    let attempts = 0;
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      attempts++;
      if (attempts === 1) {
        const p2002: any = new Error('Unique constraint failed on document_versions');
        p2002.code = 'P2002';
        throw p2002;
      }
      mockTx.documentVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 2 } });
      mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-3' });
      mockTx.document.update.mockResolvedValue({
        ...sampleDoc,
        issueDate: new Date('2026-01-10T00:00:00.000Z'),
        expirationDate: new Date('2027-01-10T00:00:00.000Z'),
      });
      mockTx.auditLog.create.mockResolvedValue({ id: 'audit-renew-3' });
      return cb(mockTx);
    });

    const res = await request(app)
      .post(`/api/v1/documents/${sampleDoc.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        issueDate: '2026-01-10',
        expirationDate: '2027-01-10',
      });

    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
    expect(res.body.previousVersionNumber).toBe(3); // max(2) + 1
    expect(syncDocumentEvent).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Caso 4: renewal: P2002 on all 3 attempts
  // =========================================================================
  it('renewal: P2002 on all 3 attempts -> 409 conflict, no Google sync, new file deleted, old attachment NOT deleted', async () => {
    const oldFileName = `old-renew-p2002-${Date.now()}.pdf`;
    const oldFilePath = path.resolve(UPLOADS_DIR, oldFileName);
    fs.writeFileSync(oldFilePath, 'conteudo antigo p2002');

    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: `/api/v1/uploads/${oldFileName}`,
      attachmentFilename: 'antigo.pdf',
    });

    const deleteSpy = vi.spyOn(storageService, 'deleteUploadedFile');

    let attempts = 0;
    (prisma.$transaction as any).mockImplementation(async () => {
      attempts++;
      const p2002: any = new Error('Unique constraint failed on document_versions');
      p2002.code = 'P2002';
      throw p2002;
    });

    const res = await request(app)
      .post(`/api/v1/documents/${sampleDoc.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('issueDate', '2026-01-10')
      .field('expirationDate', '2027-01-10')
      .attach('attachment', Buffer.from('%PDF-1.4 novo p2002 retry'), {
        filename: 'novo.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(409);
    expect(attempts).toBe(3);
    expect(res.body.error).toBe('VERSION_CONFLICT');
    expect(res.body.message).toContain('Conflito de concorrência ao renovar');
    expect(fs.existsSync(oldFilePath)).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalledWith(`/api/v1/uploads/${oldFileName}`);
    expect(deleteSpy).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/));
    expect(syncDocumentEvent).not.toHaveBeenCalled();

    if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  });

  // =========================================================================
  // Caso 5: renewal success
  // =========================================================================
  it('renewal success -> version number = max+1, previous attachment preserved (not deleted), no Google sync', async () => {
    const mockTx = getMockTx();
    const oldFileName = `old-renew-success-${Date.now()}.pdf`;
    const oldFilePath = path.resolve(UPLOADS_DIR, oldFileName);
    fs.writeFileSync(oldFilePath, 'conteudo antigo para sucesso');

    const previousAttachmentUrl = `/api/v1/uploads/${oldFileName}`;
    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: previousAttachmentUrl,
      attachmentFilename: 'antigo.pdf',
    });

    // Simula versões existentes [1, 2, 5] -> max é 5
    mockTx.documentVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 5 } });
    mockTx.documentVersion.create.mockResolvedValue({ id: 'ver-6' });
    mockTx.document.update.mockImplementation(async ({ data }: any) => ({
      ...sampleDoc,
      ...data,
      expirationDate: new Date('2027-01-10T00:00:00.000Z'),
    }));
    mockTx.auditLog.create.mockResolvedValue({ id: 'audit-renew-success' });

    const deleteSpy = vi.spyOn(storageService, 'deleteUploadedFile');

    const timeline: string[] = [];
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const result = await cb(mockTx);
      timeline.push('tx-committed');
      expect(fs.existsSync(oldFilePath)).toBe(true);
      return result;
    });

    const res = await request(app)
      .post(`/api/v1/documents/${sampleDoc.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('issueDate', '2026-01-10')
      .field('expirationDate', '2027-01-10')
      .attach('attachment', Buffer.from('%PDF-1.4 novo anexo sucesso'), {
        filename: 'novo.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body.previousVersionNumber).toBe(6); // 5 + 1 = 6
    expect(timeline).toEqual(['tx-committed']);

    // O anexo anterior NÃO foi deletado do disco e deleteUploadedFile NÃO foi chamado para ele (RN-002)
    expect(deleteSpy).not.toHaveBeenCalledWith(previousAttachmentUrl);
    expect(deleteSpy).not.toHaveBeenCalledWith(oldFileName);
    expect(fs.existsSync(oldFilePath)).toBe(true);

    // Sync com Google Agenda não é disparado na renovação (R3)
    expect(syncDocumentEvent).not.toHaveBeenCalled();

    // Limpeza
    if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
    if (res.body.document?.attachmentUrl) {
      const generatedFile = path.resolve(UPLOADS_DIR, path.basename(res.body.document.attachmentUrl));
      if (fs.existsSync(generatedFile)) fs.unlinkSync(generatedFile);
    }
  });

  // =========================================================================
  // Caso 6: create: tx.auditLog.create throws
  // =========================================================================
  it('create: tx.auditLog.create throws -> 5xx, uploaded file deleted, no committed document (tx rejected), no Google sync', async () => {
    const mockTx = getMockTx();
    (prisma.companyConfig.findFirst as any).mockResolvedValue({
      notificationMode: NotificationMode.ALL_ADMINS,
    });
    (prisma.documentCategory.findUnique as any).mockResolvedValue({
      id: validCategoryId,
      name: 'Fiscal',
    });

    let uploadedFilename: string | null = null;
    mockTx.document.create.mockImplementation(async ({ data }: any) => {
      if (data.attachmentUrl) {
        uploadedFilename = path.basename(data.attachmentUrl);
      }
      return { ...sampleDoc, ...data, id: 'doc-created-id' };
    });
    mockTx.auditLog.create.mockRejectedValue(new Error('Erro simulado ao gravar auditoria na criação'));

    const res = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Alvará Temporário')
      .field('categoryId', validCategoryId)
      .field('issueDate', '2026-01-01')
      .field('expirationDate', '2026-12-31')
      .attach('attachment', Buffer.from('%PDF-1.4 create failure test'), {
        filename: 'alvara.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(500);
    expect(syncDocumentEvent).not.toHaveBeenCalled();

    // Verifica que o arquivo físico enviado foi limpo do disco
    if (uploadedFilename) {
      const filePath = path.resolve(UPLOADS_DIR, uploadedFilename);
      expect(fs.existsSync(filePath)).toBe(false);
    }
  });

  // =========================================================================
  // Caso 7: create success
  // =========================================================================
  it('create success -> unchanged response, Google sync after commit', async () => {
    const mockTx = getMockTx();
    (prisma.companyConfig.findFirst as any).mockResolvedValue({
      notificationMode: NotificationMode.ALL_ADMINS,
    });
    (prisma.documentCategory.findUnique as any).mockResolvedValue({
      id: validCategoryId,
      name: 'Fiscal',
    });

    const timeline: string[] = [];
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const result = await cb(mockTx);
      timeline.push('commit');
      return result;
    });

    mockTx.document.create.mockImplementation(async ({ data }: any) => ({
      ...sampleDoc,
      ...data,
      id: 'doc-created-success',
    }));
    mockTx.auditLog.create.mockResolvedValue({ id: 'audit-create-success' });

    (syncDocumentEvent as any).mockImplementation(async () => {
      timeline.push('sync');
      return { status: SyncStatus.SYNCED };
    });

    const res = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Certidão Regular',
        categoryId: validCategoryId,
        issueDate: '2026-01-01',
        expirationDate: '2026-12-31',
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Documento cadastrado com sucesso.');
    expect(res.body.document.id).toBe('doc-created-success');
    expect(timeline).toEqual(['commit', 'sync']);
    expect(syncDocumentEvent).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Caso 8: archive: audit log throws
  // =========================================================================
  it('archive: audit log throws -> transaction rejected, document not left archived, no Google sync', async () => {
    const mockTx = getMockTx();
    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      isArchived: false,
    });

    mockTx.document.update.mockResolvedValue({
      ...sampleDoc,
      isArchived: true,
    });
    mockTx.auditLog.create.mockRejectedValue(new Error('Erro simulado ao gravar auditLog no arquivamento'));

    const res = await request(app)
      .patch(`/api/v1/documents/${sampleDoc.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(deleteDocumentEvent).not.toHaveBeenCalled();
    expect(syncDocumentEvent).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Caso 9: delete: delete throws
  // =========================================================================
  it('delete: delete throws -> transaction rejected, no audit-only orphan, attachment file not deleted, response is 5xx', async () => {
    const mockTx = getMockTx();
    const testFile = `to-delete-fail-${Date.now()}.pdf`;
    const testFilePath = path.resolve(UPLOADS_DIR, testFile);
    fs.writeFileSync(testFilePath, 'arquivo que nao deve ser deletado');

    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: `/api/v1/uploads/${testFile}`,
    });

    mockTx.auditLog.create.mockResolvedValue({ id: 'audit-del-fail' });
    mockTx.document.delete.mockRejectedValue(new Error('Erro simulado ao deletar documento no banco'));

    const res = await request(app)
      .delete(`/api/v1/documents/${sampleDoc.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    // 1. Resposta 5xx
    expect(res.status).toBe(500);

    // 2. Transação tentou executar e foi rejeitada
    expect(mockTx.document.delete).toHaveBeenCalledWith({ where: { id: sampleDoc.id } });

    // 3. Arquivo não pode ser deletado quando a transação falha
    expect(fs.existsSync(testFilePath)).toBe(true);

    // 4. deleteDocumentEvent ter sido chamado antes da transação é o comportamento esperado
    expect(deleteDocumentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: sampleDoc.id })
    );

    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  // =========================================================================
  // Caso 10: delete success
  // =========================================================================
  it('delete success -> deleteDocumentEvent called before $transaction, attachment file deleted only after commit', async () => {
    const mockTx = getMockTx();
    const testFile = `to-delete-success-${Date.now()}.pdf`;
    const testFilePath = path.resolve(UPLOADS_DIR, testFile);
    fs.writeFileSync(testFilePath, 'arquivo a ser deletado com sucesso');

    (prisma.document.findUnique as any).mockResolvedValue({
      ...sampleDoc,
      attachmentUrl: `/api/v1/uploads/${testFile}`,
    });

    const timeline: string[] = [];
    (deleteDocumentEvent as any).mockImplementation(async () => {
      timeline.push('gcal-delete');
      return { status: SyncStatus.DELETED };
    });

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      timeline.push('commit');
      // No momento do commit, o arquivo físico ainda não foi deletado
      expect(fs.existsSync(testFilePath)).toBe(true);
      const result = await cb(mockTx);
      return result;
    });

    mockTx.auditLog.create.mockResolvedValue({ id: 'audit-del-success' });
    mockTx.document.delete.mockResolvedValue(sampleDoc);

    const res = await request(app)
      .delete(`/api/v1/documents/${sampleDoc.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Documento excluído permanentemente com sucesso.');

    // deleteDocumentEvent foi chamado ANTES de $transaction
    expect((deleteDocumentEvent as any).mock.invocationCallOrder[0]).toBeLessThan(
      (prisma.$transaction as any).mock.invocationCallOrder[0]
    );
    expect(timeline).toEqual(['gcal-delete', 'commit']);

    // Arquivo foi removido do disco após o commit
    expect(fs.existsSync(testFilePath)).toBe(false);
    expect(deleteDocumentEvent).toHaveBeenCalledTimes(1);
    expect(deleteDocumentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: sampleDoc.id })
    );
  });
});
