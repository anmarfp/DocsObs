import { describe, it, expect } from 'vitest';
import {
  getRequest,
  getApiPath,
  getAuthTokens,
  getCategoryId,
  uniqueValue,
} from './helpers/auth.helper.js';

describe('TC-E2E-05: Calendario e sincronizacao Google (OAuth por usuario) (RF-005)', () => {
  const req = getRequest();

  it('lista o evento criado no mes/ano e registra ERROR de sincronizacao sem conta Google conectada', async () => {
    const { adminToken, operationalToken } = await getAuthTokens();
    const categoryId = await getCategoryId(adminToken);
    const targetYear = new Date().getUTCFullYear() + 2;
    const targetMonth = 6;
    const targetDate = `${targetYear}-06-15`;
    const title = uniqueValue('calendario-e2e');

    const created = await req
      .post(getApiPath('/api/v1/documents'))
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', title)
      .field('categoryId', categoryId)
      .field('issueDate', `${targetYear - 1}-01-01`)
      .field('expirationDate', targetDate);
    expect(created.status).toBe(201);
    const documentId = created.body.document.id as string;

    const events = await req
      .get(getApiPath(`/api/v1/calendar/events?year=${targetYear}&month=${targetMonth}`))
      .set('Authorization', `Bearer ${operationalToken}`);
    expect(events.status).toBe(200);
    expect(events.body.events.find((event: any) => event.id === documentId)).toMatchObject({
      title,
      expirationDate: expect.stringContaining(targetDate),
    });

    const sync = await req
      .post(getApiPath('/api/v1/calendar/sync'))
      .set('Authorization', `Bearer ${operationalToken}`);
    expect(sync.status).toBe(200);
    expect(sync.body.total).toBeGreaterThanOrEqual(1);
    expect(typeof sync.body.synced).toBe('number');

    const logs = await req
      .get(getApiPath('/api/v1/calendar/sync-logs?page=1&limit=100'))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logs.status).toBe(200);
    const documentLogs = logs.body.logs.filter((log: any) => log.documentId === documentId);
    expect(documentLogs.length).toBeGreaterThanOrEqual(1);
    expect(
      documentLogs.some(
        (log: any) =>
          log.status === 'ERROR' &&
          log.errorMessage === 'Usuário não conectou o Google Agenda.'
      )
    ).toBe(true);
  });

  it('bloqueia logs de sincronizacao para Operacional', async () => {
    const { operationalToken } = await getAuthTokens();
    const response = await req
      .get(getApiPath('/api/v1/calendar/sync-logs'))
      .set('Authorization', `Bearer ${operationalToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });
});
