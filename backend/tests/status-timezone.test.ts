import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentStatus, Role } from '@prisma/client';

/**
 * DOC-27 / DOC-40 — regressão de fuso horário.
 *
 * `expirationDate` é data civil gravada como meia-noite UTC; "hoje" e o filtro de
 * período da auditoria usam a data civil no fuso de negócio `APP_TIMEZONE` (padrão
 * America/Sao_Paulo). Estes testes precisam passar com o processo em qualquer fuso
 * (rodar com TZ=America/Sao_Paulo, TZ=UTC e TZ=Asia/Tokyo).
 */

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  const env = { ...actual.env };
  return { ...actual, env };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    document: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    documentCategory: {
      findMany: vi.fn(),
    },
    auditLog: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    companyConfig: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { calculateDocumentStatus, getDaysUntilExpiration } from '../src/services/statusService.js';
import { recalculateAllStatuses } from '../src/services/cronService.js';
import { getCalendarEvents } from '../src/controllers/calendarController.js';
import { listAuditLogs } from '../src/controllers/auditController.js';
import { getDashboardMetrics } from '../src/services/dashboardService.js';
import {
  getBusinessToday,
  getCivilDateInTimeZone,
  getStartOfCivilDayInTimeZone,
} from '../src/utils/date.js';

const initialAppTimeZone = env.APP_TIMEZONE;

/** Verifica se uma data satisfaz o filtro Prisma `{ gte, lte }`. */
function inRange(range: { gte: Date; lte: Date }, date: Date): boolean {
  return date.getTime() >= range.gte.getTime() && date.getTime() <= range.lte.getTime();
}

/** Verifica se um instante satisfaz o filtro Prisma `{ gte?, lt? }` da auditoria. */
function inHalfOpenRange(range: { gte?: Date; lt?: Date }, date: Date): boolean {
  if (range.gte && date.getTime() < range.gte.getTime()) return false;
  if (range.lt && date.getTime() >= range.lt.getTime()) return false;
  return true;
}

describe('DOC-27 - datas civis em UTC e "hoje" no fuso de negócio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).APP_TIMEZONE = 'America/Sao_Paulo';
  });

  afterEach(() => {
    vi.useRealTimers();
    (env as any).APP_TIMEZONE = initialAppTimeZone;
  });

  afterAll(() => {
    (env as any).APP_TIMEZONE = initialAppTimeZone;
  });

  describe('calculateDocumentStatus (fronteira da meia-noite)', () => {
    const cases: Array<{ now: string; expiration: string; expected: DocumentStatus; label: string }> = [
      { now: '2026-08-30T12:00:00.000Z', expiration: '2026-08-30T00:00:00.000Z', expected: DocumentStatus.CRITICAL, label: 'vence hoje' },
      { now: '2026-08-31T01:00:00.000Z', expiration: '2026-08-30T00:00:00.000Z', expected: DocumentStatus.CRITICAL, label: '30/08 22:00 local, ainda é o dia 30' },
      { now: '2026-08-31T03:30:00.000Z', expiration: '2026-08-30T00:00:00.000Z', expected: DocumentStatus.EXPIRED, label: '31/08 00:30 local, venceu ontem' },
      { now: '2026-08-30T12:00:00.000Z', expiration: '2026-09-29T00:00:00.000Z', expected: DocumentStatus.CRITICAL, label: '30 dias' },
      { now: '2026-08-30T12:00:00.000Z', expiration: '2026-09-30T00:00:00.000Z', expected: DocumentStatus.REGULAR, label: '31 dias' },
    ];

    it.each(cases)('$label: now=$now, vencimento=$expiration -> $expected', ({ now, expiration, expected }) => {
      expect(calculateDocumentStatus(new Date(expiration), 30, false, new Date(now))).toBe(expected);
    });

    it('usa o relógio atual (congelado) quando baseDate não é informado', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
      expect(calculateDocumentStatus(new Date('2026-08-30T00:00:00.000Z'), 30)).toBe(DocumentStatus.CRITICAL);
      expect(getDaysUntilExpiration(new Date('2026-08-30T00:00:00.000Z'))).toBe(0);
    });

    it('INDETERMINATE para vencimento nulo e RENEWAL_IN_PROGRESS preservado', () => {
      const now = new Date('2026-08-30T12:00:00.000Z');
      expect(calculateDocumentStatus(null, 30, false, now)).toBe(DocumentStatus.INDETERMINATE);
      expect(calculateDocumentStatus(new Date('2026-08-29T00:00:00.000Z'), 30, true, now)).toBe(
        DocumentStatus.RENEWAL_IN_PROGRESS
      );
    });

    it('respeita APP_TIMEZONE diferente do padrão', () => {
      // 2026-08-30T23:30Z é 31/08 08:30 em Tóquio e 30/08 20:30 em São Paulo
      const now = new Date('2026-08-30T23:30:00.000Z');
      const expiration = new Date('2026-08-30T00:00:00.000Z');
      expect(calculateDocumentStatus(expiration, 30, false, now)).toBe(DocumentStatus.CRITICAL);
      (env as any).APP_TIMEZONE = 'Asia/Tokyo';
      expect(calculateDocumentStatus(expiration, 30, false, now)).toBe(DocumentStatus.EXPIRED);
    });

    it('cai no padrão America/Sao_Paulo quando APP_TIMEZONE é inválido', () => {
      (env as any).APP_TIMEZONE = 'Fuso/Inexistente';
      expect(getBusinessToday(new Date('2026-08-31T01:00:00.000Z'))).toEqual(new Date('2026-08-30T00:00:00.000Z'));
    });

    it('getCivilDateInTimeZone retorna a data civil como meia-noite UTC', () => {
      expect(getCivilDateInTimeZone(new Date('2026-08-31T02:59:59.999Z'), 'America/Sao_Paulo')).toEqual(
        new Date('2026-08-30T00:00:00.000Z')
      );
      expect(getCivilDateInTimeZone(new Date('2026-08-31T03:00:00.000Z'), 'America/Sao_Paulo')).toEqual(
        new Date('2026-08-31T00:00:00.000Z')
      );
    });
  });

  describe('cronService.recalculateAllStatuses', () => {
    it('persiste CRITICAL (e não EXPIRED) para documento que vence hoje', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
      const doc = {
        id: 'doc-today',
        title: 'Vence hoje',
        expirationDate: new Date('2026-08-30T00:00:00.000Z'),
        alertLeadDays: 30,
        status: DocumentStatus.REGULAR,
        isArchived: false,
        responsibleEmail: null,
      };
      (prisma.document.findMany as any).mockResolvedValue([doc]);
      (prisma.document.update as any).mockResolvedValue({ ...doc, status: DocumentStatus.CRITICAL });
      (prisma.companyConfig.findFirst as any).mockResolvedValue(null);
      (prisma.user.findMany as any).mockResolvedValue([]);

      await recalculateAllStatuses();

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-today' },
        data: { status: DocumentStatus.CRITICAL },
      });
    });
  });

  describe('calendário: limites do mês em UTC', () => {
    async function getRangeFor(query: Record<string, string>) {
      (prisma.document.findMany as any).mockResolvedValue([]);
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();
      await getCalendarEvents({ query } as any, res, next);
      expect(next).not.toHaveBeenCalled();
      return (prisma.document.findMany as any).mock.calls[0][0].where.expirationDate as { gte: Date; lte: Date };
    }

    it('month=9/2026 inclui 01/09 e 30/09 e exclui 31/08 e 01/10', async () => {
      const range = await getRangeFor({ month: '9', year: '2026' });
      expect(inRange(range, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2026-09-30T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2026-08-31T00:00:00.000Z'))).toBe(false);
      expect(inRange(range, new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
    });

    it('year=2026 inclui 01/01 e 31/12 e exclui 31/12/2025 e 01/01/2027', async () => {
      const range = await getRangeFor({ year: '2026' });
      expect(inRange(range, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2026-12-31T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2025-12-31T00:00:00.000Z'))).toBe(false);
      expect(inRange(range, new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
    });
  });

  describe('dashboard: janela de próximos vencimentos', () => {
    async function getUpcomingRange(now: string) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      (prisma.document.groupBy as any).mockResolvedValue([]);
      (prisma.document.count as any).mockResolvedValue(0);
      (prisma.document.findMany as any).mockResolvedValue([]);
      (prisma.documentCategory.findMany as any).mockResolvedValue([]);

      await getDashboardMetrics(Role.ADMIN);

      return (prisma.document.findMany as any).mock.calls[0][0].where.expirationDate as { gte: Date; lte: Date };
    }

    it('inclui documento que vence hoje (data civil) e o limite de 30 dias; exclui ontem e 31 dias', async () => {
      const range = await getUpcomingRange('2026-08-30T12:00:00.000Z');
      expect(inRange(range, new Date('2026-08-30T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2026-09-29T00:00:00.000Z'))).toBe(true);
      expect(inRange(range, new Date('2026-08-29T00:00:00.000Z'))).toBe(false);
      expect(inRange(range, new Date('2026-09-30T00:00:00.000Z'))).toBe(false);
    });

    it('às 22:00 locais (01:00 UTC do dia seguinte) o dia civil ainda é hoje', async () => {
      const range = await getUpcomingRange('2026-08-31T01:00:00.000Z');
      expect(inRange(range, new Date('2026-08-30T00:00:00.000Z'))).toBe(true);
    });
  });

  describe('auditoria (DOC-40): filtro de período por data civil em APP_TIMEZONE', () => {
    async function getAuditWhereFor(query: Record<string, string>) {
      (prisma.auditLog.count as any).mockResolvedValue(0);
      (prisma.auditLog.findMany as any).mockResolvedValue([]);
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();
      await listAuditLogs({ query } as any, res, next);
      expect(next).not.toHaveBeenCalled();
      return (prisma.auditLog.findMany as any).mock.calls[0][0].where as {
        timestamp?: { gte?: Date; lt?: Date };
      };
    }

    const boundaryCases: Array<{ timestamp: string; included: boolean }> = [
      { timestamp: '2026-10-14T02:59:59Z', included: false },
      { timestamp: '2026-10-14T03:00:00Z', included: true },
      { timestamp: '2026-10-15T02:59:59Z', included: true },
      { timestamp: '2026-10-15T03:00:00Z', included: false },
    ];

    it.each(boundaryCases)(
      'startDate=2026-10-14&endDate=2026-10-14 -> evento $timestamp incluído=$included',
      async ({ timestamp, included }) => {
        const where = await getAuditWhereFor({ startDate: '2026-10-14', endDate: '2026-10-14' });
        expect(where.timestamp).toEqual({
          gte: new Date('2026-10-14T03:00:00.000Z'),
          lt: new Date('2026-10-15T03:00:00.000Z'),
        });
        expect(inHalfOpenRange(where.timestamp!, new Date(timestamp))).toBe(included);
      }
    );

    it('não aplica filtro de data quando startDate e endDate estão ausentes', async () => {
      const where = await getAuditWhereFor({});
      expect(where.timestamp).toBeUndefined();
    });

    it('aplica apenas o limite informado quando só startDate ou só endDate é enviado', async () => {
      const startOnly = await getAuditWhereFor({ startDate: '2026-10-14' });
      expect(startOnly.timestamp).toEqual({
        gte: new Date('2026-10-14T03:00:00.000Z'),
      });
      expect(startOnly.timestamp?.lt).toBeUndefined();

      vi.clearAllMocks();
      const endOnly = await getAuditWhereFor({ endDate: '2026-10-14' });
      expect(endOnly.timestamp).toEqual({
        lt: new Date('2026-10-15T03:00:00.000Z'),
      });
      expect(endOnly.timestamp?.gte).toBeUndefined();
    });

    it('getStartOfCivilDayInTimeZone respeita fusos distintos independentemente do TZ do host', () => {
      expect(getStartOfCivilDayInTimeZone('2026-10-14', 'America/Sao_Paulo')).toEqual(
        new Date('2026-10-14T03:00:00.000Z')
      );
      expect(getStartOfCivilDayInTimeZone('2026-10-14', 'UTC')).toEqual(
        new Date('2026-10-14T00:00:00.000Z')
      );
      expect(getStartOfCivilDayInTimeZone('2026-10-14', 'Asia/Tokyo')).toEqual(
        new Date('2026-10-13T15:00:00.000Z')
      );
    });
  });
});
