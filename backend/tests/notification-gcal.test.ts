import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DocumentStatus, NotificationMode, Role, SyncStatus } from '@prisma/client';

/**
 * Mock da lib `googleapis` para o `gcalService` real (DOC-28, subtarefa 3) — mesmo
 * padrão de `google-auth.test.ts`: `OAuth2` precisa ser uma `function` "de
 * verdade" (não arrow function) porque o código faz `new google.auth.OAuth2(...)`.
 */
const mockSetCredentials = vi.fn();
const mockOn = vi.fn();
const mockEventsInsert = vi.fn();
const mockEventsUpdate = vi.fn();
const mockEventsDelete = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function GoogleOAuth2Mock() {
        return {
          setCredentials: mockSetCredentials,
          on: mockOn,
        };
      }),
    },
    calendar: vi.fn(() => ({
      events: {
        insert: mockEventsInsert,
        update: mockEventsUpdate,
        delete: mockEventsDelete,
      },
    })),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    companyConfig: { findFirst: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    document: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    gCalSyncLog: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    googleOAuthToken: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';

/**
 * Contrato do Passo 8. Estes imports são dinâmicos para que as verificações de
 * rota continuem a diagnosticar a ausência das rotas quando o módulo ainda não
 * tiver sido implementado.
 */
type NotificationService = typeof import('../src/services/notificationService.js');
type CronService = typeof import('../src/services/cronService.js');
type GCalService = typeof import('../src/services/gcalService.js');

const today = new Date('2026-08-26T12:00:00.000Z');
const category = { id: 'category-1', name: 'Fiscal', colorHex: '#3b82f6' };
const documentFixture = {
  id: 'document-1',
  title: 'Certidão Negativa de Débitos',
  categoryId: category.id,
  category,
  issueDate: new Date('2026-01-01T00:00:00.000Z'),
  expirationDate: new Date('2026-08-30T00:00:00.000Z'),
  alertLeadDays: 10,
  status: DocumentStatus.REGULAR,
  responsibleName: 'Responsável DocsObs',
  responsibleEmail: 'responsavel@docsobs.com',
  isArchived: false,
  createdById: 'admin-1',
};
const admins = [
  { id: 'admin-1', name: 'Admin Um', email: 'admin1@docsobs.com', role: Role.ADMIN, isActive: true },
  { id: 'admin-2', name: 'Admin Dois', email: 'admin2@docsobs.com', role: Role.ADMIN, isActive: true },
];

describe('Passo 8 - Notificações, cron e Google Calendar', () => {
  const adminToken = generateToken({
    userId: 'admin-1', email: admins[0].email, name: admins[0].name, role: Role.ADMIN,
  });
  const operationalToken = generateToken({
    userId: 'operational-1', email: 'operational@docsobs.com', name: 'Operacional', role: Role.OPERATIONAL,
  });

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.companyConfig.findFirst as any).mockResolvedValue({
      id: 'config-1', notificationMode: NotificationMode.ALL_ADMINS,
    });
    (prisma.user.findMany as any).mockResolvedValue(admins);
  });

  describe('notificationService', () => {
    let notificationService: NotificationService;

    beforeAll(async () => {
      notificationService = await import('../src/services/notificationService.js');
    });

    it('resolve os administradores ativos como destinatários no modo ALL_ADMINS', () => {
      const recipients = notificationService.resolveNotificationRecipients(
        documentFixture as any,
        { notificationMode: NotificationMode.ALL_ADMINS } as any,
        admins as any,
      );

      expect(recipients).toEqual(['admin1@docsobs.com', 'admin2@docsobs.com']);
    });

    it('resolve somente o e-mail do responsável no modo ONLY_RESPONSIBLE', () => {
      const recipients = notificationService.resolveNotificationRecipients(
        documentFixture as any,
        { notificationMode: NotificationMode.ONLY_RESPONSIBLE } as any,
        admins as any,
      );

      expect(recipients).toEqual(['responsavel@docsobs.com']);
    });

    it('envia alerta crítico formatado com status CRITICAL e dados do documento', async () => {
      const result = await notificationService.sendExpirationAlert(
        { ...documentFixture, status: DocumentStatus.CRITICAL } as any,
        ['admin1@docsobs.com'],
        true,
      );

      expect(result).toEqual(expect.objectContaining({ status: DocumentStatus.CRITICAL }));
      expect(result).toEqual(expect.objectContaining({ recipients: ['admin1@docsobs.com'] }));
      expect(result).toEqual(expect.objectContaining({ subject: expect.stringContaining(documentFixture.title) }));
    });

    it('envia alerta vencido formatado com status EXPIRED', async () => {
      const result = await notificationService.sendExpirationAlert(
        { ...documentFixture, status: DocumentStatus.EXPIRED } as any,
        ['responsavel@docsobs.com'],
        false,
      );

      expect(result).toEqual(expect.objectContaining({ status: DocumentStatus.EXPIRED }));
      expect(result).toEqual(expect.objectContaining({ recipients: ['responsavel@docsobs.com'] }));
      expect(result).toEqual(expect.objectContaining({ subject: expect.stringMatching(/vencid/i) }));
    });

    it('envia o digest diário consolidando os documentos que exigem ação', async () => {
      const summary = {
        critical: [{ ...documentFixture, status: DocumentStatus.CRITICAL }],
        expired: [{ ...documentFixture, id: 'document-2', status: DocumentStatus.EXPIRED }],
        total: 2,
      };

      const result = await notificationService.sendDailyDigest(admins as any, summary as any);

      expect(result).toEqual(expect.objectContaining({ recipients: admins.map((admin) => admin.email) }));
      expect(result).toEqual(expect.objectContaining({ subject: expect.stringMatching(/digest|resumo/i) }));
      expect(result).toEqual(expect.objectContaining({ total: 2 }));
    });
  });

  describe('cronService', () => {
    let cronService: CronService;

    beforeAll(async () => {
      cronService = await import('../src/services/cronService.js');
    });

    // Congela o relógio em `today` (DOC-27): `recalculateAllStatuses()` sem baseDate usa o
    // relógio real; sem isso o teste depende da data em que a suíte roda.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(today);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('recalcula documentos ativos, preserva estados manuais e dispara alertas pertinentes', async () => {
      const critical = { ...documentFixture, id: 'critical', status: DocumentStatus.REGULAR };
      const expired = {
        ...documentFixture, id: 'expired', expirationDate: new Date('2026-08-20T00:00:00.000Z'), status: DocumentStatus.REGULAR,
      };
      const renewal = { ...documentFixture, id: 'renewal', status: DocumentStatus.RENEWAL_IN_PROGRESS };
      const indeterminate = { ...documentFixture, id: 'indeterminate', expirationDate: null, status: DocumentStatus.INDETERMINATE };
      (prisma.document.findMany as any).mockResolvedValue([critical, expired, renewal, indeterminate]);
      (prisma.document.update as any).mockImplementation(({ where, data }: any) => ({
        ...[critical, expired, renewal, indeterminate].find((document) => document.id === where.id), ...data,
      }));

      const result = await cronService.recalculateAllStatuses();

      expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isArchived: false } }));
      expect(prisma.document.update).toHaveBeenCalledTimes(2);
      expect(prisma.document.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'critical' }, data: expect.objectContaining({ status: DocumentStatus.CRITICAL }),
      }));
      expect(prisma.document.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'expired' }, data: expect.objectContaining({ status: DocumentStatus.EXPIRED }),
      }));
      expect(prisma.document.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'renewal' } }));
      expect(prisma.document.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'indeterminate' } }));
      expect(result).toEqual({ totalProcessed: 4, updatedCount: 2, alertsSent: 2 });
    });

    it('executa o digest diário para os administradores ativos', async () => {
      (prisma.document.findMany as any).mockResolvedValue([
        { ...documentFixture, status: DocumentStatus.CRITICAL },
        { ...documentFixture, id: 'expired', status: DocumentStatus.EXPIRED },
      ]);

      const result = await cronService.runDailyDigestJob();

      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { role: Role.ADMIN, isActive: true },
      }));
      expect(result).toEqual(expect.objectContaining({ recipients: admins.map((admin) => admin.email) }));
    });
  });

  describe('gcalService', () => {
    let gcalService: GCalService;

    const googleToken = {
      id: 'token-1',
      userId: 'admin-1',
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiryDate: new Date(Date.now() + 3600 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
    };

    beforeAll(async () => {
      gcalService = await import('../src/services/gcalService.js');
    });

    beforeEach(() => {
      mockEventsInsert.mockReset();
      mockEventsUpdate.mockReset();
      mockEventsDelete.mockReset();
      mockOn.mockClear();
      mockSetCredentials.mockClear();
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(googleToken);
      (prisma.googleOAuthToken.update as any).mockResolvedValue({ id: 'token-1' });
      (prisma.gCalSyncLog.findMany as any).mockResolvedValue([]);
      (prisma.gCalSyncLog.create as any).mockResolvedValue({ id: 'sync-log-1' });
    });

    afterAll(() => {
      mockEventsInsert.mockReset();
      mockEventsUpdate.mockReset();
      mockEventsDelete.mockReset();
      (prisma.googleOAuthToken.findUnique as any).mockReset();
    });

    it('cria um evento novo (insert) quando não há sincronização anterior e grava o gcalEventId real retornado pela API', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-real-event-1' } });

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(prisma.googleOAuthToken.findUnique).toHaveBeenCalledWith({ where: { userId: documentFixture.createdById } });
      expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: documentFixture.title,
          start: { date: '2026-08-30' },
          end: { date: '2026-08-31' },
        }),
      }));
      expect(mockEventsUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({ documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED });
      expect(prisma.gCalSyncLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED }),
      }));
    });

    it('atualiza o evento existente (update) quando já há um gcalEventId sincronizado — não duplica', async () => {
      (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
        { id: 'log-1', documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED, lastSyncedAt: today },
      ]);
      mockEventsUpdate.mockResolvedValue({ data: { id: 'gcal-real-event-1' } });

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'update');

      expect(mockEventsUpdate).toHaveBeenCalledWith(expect.objectContaining({
        calendarId: 'primary',
        eventId: 'gcal-real-event-1',
        requestBody: expect.objectContaining({ summary: documentFixture.title }),
      }));
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(result).toEqual({ documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED });
      expect(prisma.gCalSyncLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED }),
      }));
    });

    it('cria um evento novo (insert) em vez de reaproveitar um gcalEventId cujo registro mais recente é DELETED', async () => {
      // Regressão: se o evento foi removido (ex.: documento arquivado) depois do
      // último SYNCED, a próxima sincronização não pode tentar "update" num
      // evento que não existe mais no Google Agenda.
      (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
        { id: 'log-2', documentId: documentFixture.id, gcalEventId: null, status: SyncStatus.DELETED, lastSyncedAt: today },
      ]);
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-real-event-novo' } });

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'update');

      expect(mockEventsUpdate).not.toHaveBeenCalled();
      expect(mockEventsInsert).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ gcalEventId: 'gcal-real-event-novo', status: SyncStatus.SYNCED }));
    });

    it('busca o último evento ignorando tentativas ERROR na query (uma falha transitória não deve "esquecer" o evento real)', async () => {
      // A consulta filtra status SYNCED/DELETED — uma linha ERROR (falha de rede,
      // rate limit etc. após um SYNCED bem-sucedido) nunca chega a ser candidata,
      // então a próxima sincronização continua enxergando o último evento real em
      // vez de criar um duplicado via insert.
      (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
        { id: 'log-1', documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED, lastSyncedAt: today },
      ]);
      mockEventsUpdate.mockResolvedValue({ data: { id: 'gcal-real-event-1' } });

      await gcalService.syncDocumentEvent(documentFixture as any, 'update');

      expect(prisma.gCalSyncLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: [SyncStatus.SYNCED, SyncStatus.DELETED] } }),
      }));
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockEventsUpdate).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'gcal-real-event-1' }));
    });

    it('registra ERROR no log quando o documento não tem data de vencimento (sem tentar chamar a API)', async () => {
      const result = await gcalService.syncDocumentEvent({ ...documentFixture, expirationDate: null } as any, 'update');

      expect(result).toEqual(expect.objectContaining({ status: SyncStatus.ERROR, errorMessage: expect.any(String) }));
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockEventsUpdate).not.toHaveBeenCalled();
      expect(prisma.gCalSyncLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ documentId: documentFixture.id, status: SyncStatus.ERROR, errorMessage: expect.any(String) }),
      }));
    });

    it('grava ERROR com mensagem clara quando o usuário (criador do documento) nunca conectou o Google Agenda', async () => {
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        status: SyncStatus.ERROR,
        errorMessage: expect.stringMatching(/não conectou/i),
      }));
      expect(prisma.gCalSyncLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: SyncStatus.ERROR, errorMessage: expect.stringMatching(/não conectou/i) }),
      }));
    });

    it('grava ERROR com mensagem específica quando o Google rejeita o token (invalid_grant / revogado)', async () => {
      mockEventsInsert.mockRejectedValue({
        code: 400,
        response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
        message: 'invalid_grant',
      });

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(result).toEqual(expect.objectContaining({
        status: SyncStatus.ERROR,
        errorMessage: expect.stringMatching(/autorização|revogad/i),
      }));
    });

    it('grava ERROR com mensagem específica em falha de rede ao chamar a API do Google Agenda', async () => {
      mockEventsInsert.mockRejectedValue(
        Object.assign(new Error('getaddrinfo ENOTFOUND www.googleapis.com'), { code: 'ENOTFOUND' })
      );

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(result).toEqual(expect.objectContaining({
        status: SyncStatus.ERROR,
        errorMessage: expect.stringMatching(/rede/i),
      }));
    });

    it('grava ERROR com mensagem específica em erro de rate limit / quota da API do Google', async () => {
      mockEventsInsert.mockRejectedValue({
        code: 403,
        errors: [{ reason: 'rateLimitExceeded' }],
        message: 'Rate Limit Exceeded',
      });

      const result = await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(result).toEqual(expect.objectContaining({
        status: SyncStatus.ERROR,
        errorMessage: expect.stringMatching(/limite|rate limit|quota/i),
      }));
    });

    it('persiste a renovação automática do access_token quando o evento "tokens" da lib googleapis dispara', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-real-event-1' } });

      await gcalService.syncDocumentEvent(documentFixture as any, 'create');

      expect(mockOn).toHaveBeenCalledWith('tokens', expect.any(Function));
      const [, tokensListener] = mockOn.mock.calls[mockOn.mock.calls.length - 1];

      const newExpiry = Date.now() + 7200 * 1000;
      tokensListener({ access_token: 'novo-access-token', expiry_date: newExpiry });

      expect(prisma.googleOAuthToken.update).toHaveBeenCalledWith({
        where: { userId: documentFixture.createdById },
        data: expect.objectContaining({ accessToken: 'novo-access-token', expiryDate: new Date(newExpiry) }),
      });
    });

    it('sincroniza em lote todos os documentos ativos com vencimento e agrega os totais', async () => {
      const secondDocument = { ...documentFixture, id: 'document-2' };
      (prisma.document.findMany as any).mockResolvedValue([documentFixture, secondDocument]);
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-real-event-batch' } });

      const result = await gcalService.syncAllDocuments();

      expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ isArchived: false, expirationDate: { not: null } }),
      }));
      expect(result).toEqual(expect.objectContaining({ total: 2, synced: 2 }));
    });

    it('agrega os totais corretamente quando parte dos documentos falha ao sincronizar', async () => {
      const secondDocument = { ...documentFixture, id: 'document-2' };
      (prisma.document.findMany as any).mockResolvedValue([documentFixture, secondDocument]);
      mockEventsInsert
        .mockResolvedValueOnce({ data: { id: 'gcal-real-event-ok' } })
        .mockRejectedValueOnce(new Error('network error'));

      const result = await gcalService.syncAllDocuments();

      expect(result).toEqual({ total: 2, synced: 1 });
    });

    describe('deleteDocumentEvent', () => {
      it('remove o evento no Google Agenda e grava DELETED quando há um evento sincronizado', async () => {
        (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
          { id: 'log-1', documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED, lastSyncedAt: today },
        ]);
        mockEventsDelete.mockResolvedValue({});

        const result = await gcalService.deleteDocumentEvent(documentFixture as any);

        expect(mockEventsDelete).toHaveBeenCalledWith(expect.objectContaining({
          calendarId: 'primary', eventId: 'gcal-real-event-1',
        }));
        expect(result).toEqual({ documentId: documentFixture.id, status: SyncStatus.DELETED });
        expect(prisma.gCalSyncLog.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ documentId: documentFixture.id, gcalEventId: null, status: SyncStatus.DELETED }),
        }));
      });

      it('não chama a API nem grava log quando não há nenhum evento sincronizado para remover', async () => {
        const result = await gcalService.deleteDocumentEvent(documentFixture as any);

        expect(mockEventsDelete).not.toHaveBeenCalled();
        expect(prisma.gCalSyncLog.create).not.toHaveBeenCalled();
        expect(result).toEqual({ documentId: documentFixture.id, status: SyncStatus.DELETED });
      });

      it('não tenta remover de novo um evento cujo registro mais recente já é DELETED', async () => {
        (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
          { id: 'log-2', documentId: documentFixture.id, gcalEventId: null, status: SyncStatus.DELETED, lastSyncedAt: today },
        ]);

        const result = await gcalService.deleteDocumentEvent(documentFixture as any);

        expect(mockEventsDelete).not.toHaveBeenCalled();
        expect(result).toEqual({ documentId: documentFixture.id, status: SyncStatus.DELETED });
      });

      it('grava ERROR quando o usuário nunca conectou o Google Agenda', async () => {
        (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
          { id: 'log-1', documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED, lastSyncedAt: today },
        ]);
        (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);

        const result = await gcalService.deleteDocumentEvent(documentFixture as any);

        expect(mockEventsDelete).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ status: SyncStatus.ERROR, errorMessage: expect.stringMatching(/não conectou/i) }));
      });

      it('grava ERROR com mensagem específica quando a chamada de remoção falha', async () => {
        (prisma.gCalSyncLog.findMany as any).mockResolvedValue([
          { id: 'log-1', documentId: documentFixture.id, gcalEventId: 'gcal-real-event-1', status: SyncStatus.SYNCED, lastSyncedAt: today },
        ]);
        mockEventsDelete.mockRejectedValue(
          Object.assign(new Error('getaddrinfo ENOTFOUND www.googleapis.com'), { code: 'ENOTFOUND' })
        );

        const result = await gcalService.deleteDocumentEvent(documentFixture as any);

        expect(result).toEqual(expect.objectContaining({ status: SyncStatus.ERROR, errorMessage: expect.stringMatching(/rede/i) }));
      });
    });
  });

  describe('Integração das rotas de notificações', () => {
    it('protege o recálculo: 401 sem token, 403 para OPERATIONAL e 200 para ADMIN', async () => {
      const unauthorized = await request(app).post('/api/v1/notifications/recalculate');
      const forbidden = await request(app)
        .post('/api/v1/notifications/recalculate')
        .set('Authorization', `Bearer ${operationalToken}`);
      const allowed = await request(app)
        .post('/api/v1/notifications/recalculate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unauthorized.status).toBe(401);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error).toBe('FORBIDDEN');
      expect(allowed.status).toBe(200);
      expect(allowed.body).toEqual(expect.objectContaining({
        totalProcessed: expect.any(Number), updatedCount: expect.any(Number), alertsSent: expect.any(Number),
      }));
    });

    it('protege o digest: 401 sem token, 403 para OPERATIONAL e 200 para ADMIN', async () => {
      const unauthorized = await request(app).post('/api/v1/notifications/digest');
      const forbidden = await request(app)
        .post('/api/v1/notifications/digest')
        .set('Authorization', `Bearer ${operationalToken}`);
      const allowed = await request(app)
        .post('/api/v1/notifications/digest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unauthorized.status).toBe(401);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error).toBe('FORBIDDEN');
      expect(allowed.status).toBe(200);
    });
  });

  describe('Integração das rotas de calendário', () => {
    const calendarDocument = { ...documentFixture, status: DocumentStatus.CRITICAL };

    it('exige autenticação para listar eventos', async () => {
      const res = await request(app).get('/api/v1/calendar/events');
      expect(res.status).toBe(401);
    });

    it('lista eventos para ADMIN e OPERATIONAL com o contrato do calendário', async () => {
      (prisma.document.findMany as any).mockResolvedValue([calendarDocument]);

      const [adminResponse, operationalResponse] = await Promise.all([
        request(app).get('/api/v1/calendar/events').set('Authorization', `Bearer ${adminToken}`),
        request(app).get('/api/v1/calendar/events').set('Authorization', `Bearer ${operationalToken}`),
      ]);

      for (const response of [adminResponse, operationalResponse]) {
        expect(response.status).toBe(200);
        expect(response.body.events).toEqual([expect.objectContaining({
          id: calendarDocument.id,
          title: calendarDocument.title,
          expirationDate: calendarDocument.expirationDate.toISOString(),
          status: DocumentStatus.CRITICAL,
          category: expect.objectContaining({ id: category.id, name: category.name }),
          colorHex: category.colorHex,
        })]);
      }
    });

    it('aplica os filtros month e year na consulta de eventos', async () => {
      (prisma.document.findMany as any).mockResolvedValue([calendarDocument]);

      const res = await request(app)
        .get('/api/v1/calendar/events?month=8&year=2026')
        .set('Authorization', `Bearer ${operationalToken}`);

      expect(res.status).toBe(200);
      expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ expirationDate: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }) }),
      }));
    });

    it('permite sincronização sob demanda para ADMIN e OPERATIONAL, mas exige autenticação', async () => {
      const unauthorized = await request(app).post('/api/v1/calendar/sync');
      const adminResponse = await request(app)
        .post('/api/v1/calendar/sync')
        .set('Authorization', `Bearer ${adminToken}`);
      const operationalResponse = await request(app)
        .post('/api/v1/calendar/sync')
        .set('Authorization', `Bearer ${operationalToken}`);

      expect(unauthorized.status).toBe(401);
      expect(adminResponse.status).toBe(200);
      expect(operationalResponse.status).toBe(200);
    });

    it('protege os logs: 401 sem token, 403 para OPERATIONAL e 200 para ADMIN', async () => {
      const logs = [{
        id: 'sync-log-1', documentId: documentFixture.id, gcalEventId: 'event-1', status: SyncStatus.SYNCED,
        lastSyncedAt: today, errorMessage: null, document: { id: documentFixture.id, title: documentFixture.title },
      }];
      (prisma.gCalSyncLog.count as any).mockResolvedValue(1);
      (prisma.gCalSyncLog.findMany as any).mockResolvedValue(logs);

      const unauthorized = await request(app).get('/api/v1/calendar/sync-logs');
      const forbidden = await request(app)
        .get('/api/v1/calendar/sync-logs')
        .set('Authorization', `Bearer ${operationalToken}`);
      const allowed = await request(app)
        .get('/api/v1/calendar/sync-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unauthorized.status).toBe(401);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error).toBe('FORBIDDEN');
      expect(allowed.status).toBe(200);
      expect(allowed.body.logs).toEqual([expect.objectContaining({ id: 'sync-log-1', status: SyncStatus.SYNCED })]);
    });
  });
});
