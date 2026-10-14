import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { DocumentStatus, Role, NotificationMode } from '@prisma/client';

// 1. Mock do módulo env (seguindo o padrão do repositório em status-timezone.test.ts)
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  const env = { ...actual.env };
  return { ...actual, env };
});

// 2. Mock de nodemailer
const mockSendMailFn = vi.fn();
const mockCreateTransport = vi.fn(() => ({
  sendMail: mockSendMailFn,
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: any[]) => mockCreateTransport(...args),
  },
}));

// 3. Mock de node-cron
const mockCronSchedule = vi.fn();
vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: any[]) => mockCronSchedule(...args),
  },
}));

// 4. Mock do Prisma Client
const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: (...args: any[]) => mockTransaction(...args),
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    companyConfig: { findFirst: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    document: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { sendMail, resetMailTransporter } from '../src/services/mailService.js';
import { sendExpirationAlert, sendDailyDigest } from '../src/services/notificationService.js';
import { recalculateAllStatuses, runDailyDigestJob } from '../src/services/cronService.js';
import { startScheduler, stopScheduler, executeDailyJob } from '../src/services/scheduler.js';

describe('DOC-31 - Agendamento in-process (node-cron) e envio real de alertas (nodemailer)', () => {
  const originalEnv = { ...env };

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetMailTransporter();
    Object.assign(env, originalEnv);
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  describe('Cenários de Agendamento e Scheduler (Decision rule 5 & 6)', () => {
    it('startScheduler com CRON_ENABLED=true agenda diariamente a 00:00 com fuso America/Sao_Paulo', () => {
      (env as any).CRON_ENABLED = true;
      (env as any).NODE_ENV = 'production';
      (env as any).APP_TIMEZONE = 'America/Sao_Paulo';

      const task = startScheduler();

      expect(task).not.toBeNull();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
      expect(mockCronSchedule).toHaveBeenCalledWith(
        '0 0 * * *',
        expect.any(Function),
        { timezone: 'America/Sao_Paulo' }
      );
    });

    it('startScheduler com CRON_ENABLED=false ou NODE_ENV=test não agenda o cron', () => {
      // Caso 1: CRON_ENABLED=false
      (env as any).CRON_ENABLED = false;
      (env as any).NODE_ENV = 'production';

      const taskDisabled = startScheduler();
      expect(taskDisabled).toBeNull();
      expect(mockCronSchedule).not.toHaveBeenCalled();

      // Caso 2: NODE_ENV=test
      (env as any).CRON_ENABLED = true;
      (env as any).NODE_ENV = 'test';

      const taskTest = startScheduler();
      expect(taskTest).toBeNull();
      expect(mockCronSchedule).not.toHaveBeenCalled();
    });

    it('callback agendado, lock adquirido: executa recalculateAllStatuses e depois runDailyDigestJob, nessa ordem', async () => {
      const executionOrder: string[] = [];

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockImplementation(async () => {
            executionOrder.push('lock');
            return [{ locked: true }];
          }),
        };
        return await callback(tx);
      });

      (prisma.document.findMany as any).mockImplementation(async () => {
        executionOrder.push('document.findMany');
        return [];
      });
      (prisma.companyConfig.findFirst as any).mockResolvedValue({ notificationMode: NotificationMode.ALL_ADMINS });
      (prisma.user.findMany as any).mockImplementation(async () => {
        executionOrder.push('user.findMany');
        return [];
      });

      const result = await executeDailyJob();

      expect(result).toEqual(
        expect.objectContaining({
          skipped: false,
          recalculateResult: expect.objectContaining({ totalProcessed: 0 }),
          digestResult: expect.objectContaining({ total: 0 }),
        })
      );

      expect(executionOrder[0]).toBe('lock');
      expect(executionOrder).toContain('document.findMany');
      expect(executionOrder).toContain('user.findMany');
    });

    it('callback agendado, lock não adquirido: nenhum job é executado e loga como ignorado/skipped', async () => {
      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
        };
        return await callback(tx);
      });

      const result = await executeDailyJob();

      expect(result).toEqual({ skipped: true });
      expect(prisma.document.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('callback agendado, job lança erro: erro registrado em console.error sem quebrar o processo', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');
      mockTransaction.mockRejectedValue(new Error('Falha de conexão com PostgreSQL'));

      const result = await executeDailyJob();

      expect(result).toEqual({ error: 'Falha de conexão com PostgreSQL' });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Scheduler] Erro durante a execução do job diário:',
        expect.any(Error)
      );
    });

    it('relógio congelado (vi.setSystemTime) em documento cuja janela de alerta inicia hoje: status vira CRITICAL e alerta é despachado', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // Hoje é 2026-08-20 12:00 UTC
      vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));

      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'DocsObs <alertas@docsobs.com>',
      };

      const doc = {
        id: 'doc-window-today',
        title: 'Certidão Negativa',
        expirationDate: new Date('2026-08-30T00:00:00.000Z'), // faltam exatamente 10 dias civis
        alertLeadDays: 10,
        status: DocumentStatus.REGULAR,
        isArchived: false,
      };

      const admin = { id: 'admin-1', email: 'admin@docsobs.com', role: Role.ADMIN, isActive: true };

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
        };
        return await callback(tx);
      });

      (prisma.document.findMany as any).mockResolvedValue([doc]);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({ notificationMode: NotificationMode.ALL_ADMINS });
      (prisma.user.findMany as any).mockResolvedValue([admin]);
      (prisma.document.update as any).mockResolvedValue({ ...doc, status: DocumentStatus.CRITICAL });

      mockSendMailFn.mockResolvedValue({ messageId: 'alert-msg-id-123' });

      const result = await executeDailyJob();

      expect(result).toEqual(
        expect.objectContaining({
          skipped: false,
          recalculateResult: expect.objectContaining({
            updatedCount: 1,
            alertsSent: 1,
            alertsFailed: 0,
          }),
        })
      );

      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: doc.id },
          data: { status: DocumentStatus.CRITICAL },
        })
      );

      expect(mockSendMailFn).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['admin@docsobs.com'],
          subject: expect.stringContaining(doc.title),
          from: 'DocsObs <alertas@docsobs.com>',
        })
      );
    });
  });

  describe('Cenários de Transporte de E-mail (mailService)', () => {
    it('sendMail com env.smtp null: dispatched:false, erro "SMTP não configurado" e nenhum transporte criado', async () => {
      (env as any).smtp = null;
      const warnSpy = vi.spyOn(console, 'warn');

      const result = await sendMail({
        to: 'dest@docsobs.com',
        subject: 'Teste',
        text: 'Corpo',
      });

      expect(result).toEqual({ dispatched: false, error: 'SMTP não configurado' });
      expect(mockCreateTransport).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP não configurado'));
    });

    it('transporte SMTP rejeita 3 vezes: dispatched:false com o erro e 3 tentativas executadas', async () => {
      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'alertas@docsobs.com',
      };

      mockSendMailFn.mockRejectedValue(new Error('Conexão SMTP recusada'));

      const result = await sendMail({
        to: 'dest@docsobs.com',
        subject: 'Teste Rejeição',
        text: 'Corpo de teste',
      });

      expect(result).toEqual({ dispatched: false, error: 'Conexão SMTP recusada' });
      expect(mockSendMailFn).toHaveBeenCalledTimes(3);
    });

    it('transporte SMTP rejeita uma vez e depois resolve: dispatched:true em 2 tentativas', async () => {
      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'alertas@docsobs.com',
      };

      mockSendMailFn
        .mockRejectedValueOnce(new Error('Falha transitória'))
        .mockResolvedValueOnce({ messageId: 'sucesso-tentativa-2' });

      const result = await sendMail({
        to: 'dest@docsobs.com',
        subject: 'Teste Retry',
        text: 'Corpo de teste retry',
      });

      expect(result).toEqual({ dispatched: true, messageId: 'sucesso-tentativa-2' });
      expect(mockSendMailFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cenários de Notificações e Recálculo (notificationService & cronService)', () => {
    it('sendExpirationAlert quando sendMail falha: success:false, dispatched:false e console.error chamado', async () => {
      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'alertas@docsobs.com',
      };

      mockSendMailFn.mockRejectedValue(new Error('Falha de rede'));
      const errorSpy = vi.spyOn(console, 'error');

      const doc = {
        id: 'doc-err-1',
        title: 'Alvará de Funcionamento',
        status: DocumentStatus.CRITICAL,
        expirationDate: new Date('2026-08-30T00:00:00.000Z'),
      };

      const result = await sendExpirationAlert(doc, ['admin@docsobs.com'], true);

      expect(result.success).toBe(false);
      expect(result.dispatched).toBe(false);
      expect(result.error).toBe('Falha de rede');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('recalculateAllStatuses com um alerta falho e um bem-sucedido: alertsSent=1, alertsFailed=1', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));

      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'alertas@docsobs.com',
      };

      const doc1 = {
        id: 'doc-fail',
        title: 'Doc Que Falha Envio',
        expirationDate: new Date('2026-08-25T00:00:00.000Z'),
        alertLeadDays: 10,
        status: DocumentStatus.REGULAR,
        isArchived: false,
      };

      const doc2 = {
        id: 'doc-ok',
        title: 'Doc Que Tem Sucesso',
        expirationDate: new Date('2026-08-26T00:00:00.000Z'),
        alertLeadDays: 10,
        status: DocumentStatus.REGULAR,
        isArchived: false,
      };

      (prisma.document.findMany as any).mockResolvedValue([doc1, doc2]);
      (prisma.companyConfig.findFirst as any).mockResolvedValue({ notificationMode: NotificationMode.ALL_ADMINS });
      (prisma.user.findMany as any).mockResolvedValue([
        { id: 'admin-1', email: 'admin@docsobs.com', role: Role.ADMIN, isActive: true },
      ]);
      (prisma.document.update as any).mockResolvedValue({});

      // Doc 1 tenta 3 vezes e falha:
      mockSendMailFn
        .mockRejectedValueOnce(new Error('Erro doc1 tentativa 1'))
        .mockRejectedValueOnce(new Error('Erro doc1 tentativa 2'))
        .mockRejectedValueOnce(new Error('Erro doc1 tentativa 3'))
        // Doc 2 tem sucesso na 1ª tentativa:
        .mockResolvedValueOnce({ messageId: 'msg-doc2-ok' });

      const result = await recalculateAllStatuses();

      expect(result.updatedCount).toBe(2);
      expect(result.alertsSent).toBe(1);
      expect(result.alertsFailed).toBe(1);
    });

    it('e-mail de alerta para expirationDate 2026-08-30T00:00Z em host UTC-3: corpo contém 30/08/2026', async () => {
      (env as any).smtp = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'alertas@docsobs.com',
      };

      mockSendMailFn.mockResolvedValue({ messageId: 'msg-date-ok' });

      const doc = {
        id: 'doc-civil-date',
        title: 'Documento Teste de Fuso',
        status: DocumentStatus.CRITICAL,
        expirationDate: new Date('2026-08-30T00:00:00.000Z'),
      };

      const result = await sendExpirationAlert(doc, ['admin@docsobs.com'], true);

      expect(result.body).toContain('30/08/2026');
      expect(result.body).not.toContain('29/08/2026');
    });
  });
});
