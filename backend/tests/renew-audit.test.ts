import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import request from 'supertest';
import { Role, DocumentStatus, AuditAction } from '@prisma/client';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { generateToken } from '../src/utils/jwt.js';

// Mock do Prisma Client
vi.mock('../src/lib/prisma.js', () => {
  const mockPrisma: any = {
    document: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    documentVersion: {
      count: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) =>
      typeof callback === 'function' ? callback(mockPrisma) : Promise.all(callback)
    ),
  };
  return {
    prisma: mockPrisma,
  };
});

describe('Passo 7 - Renovação de Documentos, Versões e Trilha Geral de Auditoria', () => {
  const adminToken = generateToken({
    userId: 'admin-uuid-1',
    email: 'admin@docsobs.com.br',
    name: 'Admin Master',
    role: Role.ADMIN,
  });

  const opToken = generateToken({
    userId: 'op-uuid-2',
    email: 'operador@docsobs.com.br',
    name: 'Operador User',
    role: Role.OPERATIONAL,
  });

  const sampleDoc = {
    id: 'doc-uuid-100',
    title: 'Alvará de Funcionamento 2025',
    categoryId: 'cat-uuid-1',
    issuingBody: 'Prefeitura Municipal',
    issueDate: new Date('2025-01-10T00:00:00.000Z'),
    expirationDate: new Date('2026-01-10T00:00:00.000Z'),
    alertLeadDays: 30,
    status: DocumentStatus.EXPIRED,
    responsibleName: 'João Silva',
    responsibleEmail: 'joao@empresa.com.br',
    attachmentUrl: '/api/v1/uploads/alvara-2025.pdf',
    attachmentFilename: 'alvara-2025.pdf',
    fileSizeBytes: 102400,
    fileMimeType: 'application/pdf',
    notes: 'Alvará ano anterior',
    isArchived: false,
    createdById: 'admin-uuid-1',
    createdAt: new Date('2025-01-10T00:00:00.000Z'),
    updatedAt: new Date('2025-01-10T00:00:00.000Z'),
  };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ====================================================
  // 1. RENOVAÇÃO DE DOCUMENTOS (RF-003, RN-002, RN-008)
  // ====================================================
  describe('POST /api/v1/documents/:id/renew', () => {
    it('deve renovar documento arquivando versão vigente no histórico e atualizando dados vigentes (status REGULAR)', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);
      (prisma.documentVersion.count as any).mockResolvedValue(0);
      (prisma.documentVersion.aggregate as any).mockResolvedValue({ _max: { versionNumber: null } });
      (prisma.documentVersion.create as any).mockResolvedValue({
        id: 'ver-uuid-1',
        documentId: sampleDoc.id,
        versionNumber: 1,
        issueDate: sampleDoc.issueDate,
        expirationDate: sampleDoc.expirationDate,
        attachmentUrl: sampleDoc.attachmentUrl,
        attachmentFilename: sampleDoc.attachmentFilename,
      });

      const updatedDocMock = {
        ...sampleDoc,
        issueDate: new Date('2026-01-10T00:00:00.000Z'),
        expirationDate: new Date('2027-01-10T00:00:00.000Z'),
        status: DocumentStatus.REGULAR,
        notes: 'Renovação aprovada para 2027',
      };
      (prisma.document.update as any).mockResolvedValue(updatedDocMock);
      (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-renew-1' });

      const res = await request(app)
        .post(`/api/v1/documents/${sampleDoc.id}/renew`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          issueDate: '2026-01-10',
          expirationDate: '2027-01-10',
          notes: 'Renovação aprovada para 2027',
        });

      expect(res.status).toBe(200);
      expect(res.body.previousVersionNumber).toBe(1);
      expect(res.body.document.status).toBe(DocumentStatus.REGULAR);

      // Valida arquivamento da versão anterior com snapshot imutável
      expect(prisma.documentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId: sampleDoc.id,
          versionNumber: 1,
          issueDate: sampleDoc.issueDate,
          expirationDate: sampleDoc.expirationDate,
          attachmentFilename: sampleDoc.attachmentFilename,
          renewedById: 'admin-uuid-1',
        }),
      });

      // Valida gravação na trilha de auditoria com action RENEW
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId: sampleDoc.id,
          action: AuditAction.RENEW,
          diffData: expect.objectContaining({
            archivedVersionNumber: { old: null, new: 1 },
          }),
        }),
      });
    });

    it('deve rejeitar renovação com formato de data inválido (400)', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(sampleDoc);

      const res = await request(app)
        .post(`/api/v1/documents/${sampleDoc.id}/renew`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          issueDate: 'data-invalida',
          expirationDate: '2027-01-10',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('deve retornar 404 ao tentar renovar documento inexistente', async () => {
      (prisma.document.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/documents/doc-nao-existe/renew')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          issueDate: '2026-01-10',
          expirationDate: '2027-01-10',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
    });

    it('deve impedir usuário OPERATIONAL de renovar documento arquivado (404)', async () => {
      (prisma.document.findUnique as any).mockResolvedValue({
        ...sampleDoc,
        isArchived: true,
      });

      const res = await request(app)
        .post(`/api/v1/documents/${sampleDoc.id}/renew`)
        .set('Authorization', `Bearer ${opToken}`)
        .send({
          issueDate: '2026-01-10',
          expirationDate: '2027-01-10',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('DOCUMENT_NOT_FOUND');
    });
  });

  // ====================================================
  // 2. HISTÓRICO DE VERSÕES (GET /documents/:id/versions)
  // ====================================================
  describe('GET /api/v1/documents/:id/versions', () => {
    it('deve retornar a lista ordenada de versões históricas', async () => {
      (prisma.document.findUnique as any).mockResolvedValue({
        id: sampleDoc.id,
        title: sampleDoc.title,
        isArchived: false,
      });

      const sampleVersions = [
        {
          id: 'ver-2',
          documentId: sampleDoc.id,
          versionNumber: 2,
          issueDate: new Date('2025-01-10'),
          expirationDate: new Date('2026-01-10'),
          renewedBy: { id: 'admin-uuid-1', name: 'Admin Master', email: 'admin@docsobs.com.br' },
        },
        {
          id: 'ver-1',
          documentId: sampleDoc.id,
          versionNumber: 1,
          issueDate: new Date('2024-01-10'),
          expirationDate: new Date('2025-01-10'),
          renewedBy: { id: 'admin-uuid-1', name: 'Admin Master', email: 'admin@docsobs.com.br' },
        },
      ];
      (prisma.documentVersion.findMany as any).mockResolvedValue(sampleVersions);

      const res = await request(app)
        .get(`/api/v1/documents/${sampleDoc.id}/versions`)
        .set('Authorization', `Bearer ${opToken}`);

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(2);
      expect(res.body.versions[0].versionNumber).toBe(2);
      expect(prisma.documentVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { versionNumber: 'desc' } })
      );
    });
  });

  // ====================================================
  // 3. TRILHA GERAL DE AUDITORIA (RF-013 / RBAC)
  // ====================================================
  describe('Trilha Geral de Auditoria (/api/v1/audit-logs)', () => {
    const sampleAuditLogs = [
      {
        id: 'audit-1',
        documentId: sampleDoc.id,
        userId: 'admin-uuid-1',
        userName: 'Admin Master',
        action: AuditAction.CREATE,
        diffData: { title: { old: null, new: sampleDoc.title } },
        timestamp: new Date('2026-08-26T10:00:00.000Z'),
        document: { id: sampleDoc.id, title: sampleDoc.title, isArchived: false },
        user: { id: 'admin-uuid-1', name: 'Admin Master', email: 'admin@docsobs.com.br', role: Role.ADMIN },
      },
      {
        id: 'audit-2',
        documentId: sampleDoc.id,
        userId: 'admin-uuid-1',
        userName: 'Admin Master',
        action: AuditAction.RENEW,
        diffData: { archivedVersionNumber: { old: null, new: 1 } },
        timestamp: new Date('2026-08-26T11:00:00.000Z'),
        document: { id: sampleDoc.id, title: sampleDoc.title, isArchived: false },
        user: { id: 'admin-uuid-1', name: 'Admin Master', email: 'admin@docsobs.com.br', role: Role.ADMIN },
      },
    ];

    it('deve listar logs de auditoria com paginação para perfil ADMIN', async () => {
      (prisma.auditLog.count as any).mockResolvedValue(2);
      (prisma.auditLog.findMany as any).mockResolvedValue(sampleAuditLogs);

      const res = await request(app)
        .get('/api/v1/audit-logs?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.logs).toHaveLength(2);
      expect(res.body.logs[0].action).toBe(AuditAction.CREATE);
    });

    it('deve bloquear listagem de auditoria com 403 para perfil OPERATIONAL', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${opToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('deve filtrar logs por action e documentId', async () => {
      (prisma.auditLog.count as any).mockResolvedValue(1);
      (prisma.auditLog.findMany as any).mockResolvedValue([sampleAuditLogs[1]]);

      const res = await request(app)
        .get(`/api/v1/audit-logs?action=RENEW&documentId=${sampleDoc.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].action).toBe(AuditAction.RENEW);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: AuditAction.RENEW,
            documentId: sampleDoc.id,
          }),
        })
      );
    });

    it('deve retornar detalhes de um registro específico de auditoria por ID', async () => {
      (prisma.auditLog.findUnique as any).mockResolvedValue(sampleAuditLogs[0]);

      const res = await request(app)
        .get('/api/v1/audit-logs/audit-1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.log.id).toBe('audit-1');
      expect(res.body.log.action).toBe(AuditAction.CREATE);
    });

    it('deve retornar 404 para ID de log de auditoria inexistente', async () => {
      (prisma.auditLog.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/audit-logs/audit-inexistente')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('AUDIT_LOG_NOT_FOUND');
    });
  });
});
