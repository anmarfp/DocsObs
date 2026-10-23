import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { getAppTimeZone, getBusinessToday } from '../utils/date.js';
import {
  recalculateAllStatuses,
  runDailyDigestJob,
  type RecalculateStatusesResult,
} from './cronService.js';
import type { DailyDigestResult } from './notificationService.js';

export const DAILY_JOB_LOCK_KEY = 26101431n;
export const DAILY_DIGEST_JOB_NAME = 'daily-digest';

let scheduledTask: ScheduledTask | null = null;

export type DailyJobExecutionResult =
  | { skipped: true }
  | { skipped: false; recalculateResult: RecalculateStatusesResult; digestResult: DailyDigestResult }
  | { error: string };

/**
 * Executa a rotina diária de recálculo e envio de digest, protegida por advisory lock transacional no PostgreSQL
 * e por claim durável por dia civil em `job_runs` (DOC-41).
 *
 * Semântica de claim e falhas (DOC-41):
 * - O recálculo de status (`recalculateAllStatuses`) sempre executa ao adquirir o advisory lock (alertas por
 *   documento já são deduplicados apenas na transição de status).
 * - O Daily Digest é reivindicado inserindo `(job = 'daily-digest', run_date = getBusinessToday())` dentro da
 *   mesma transação do advisory lock:
 *   1. `createMany` com `skipDuplicates` retorna `count: 0` quando o digest já foi processado hoje no fuso
 *      `APP_TIMEZONE`; a execução ignora o envio sem erro.
 *   2. Se `runDailyDigestJob` lançar uma exceção inesperada (throw), a transação inteira sofre rollback,
 *      garantindo que a falha não suprima permanentemente o digest daquele dia civil em uma nova tentativa.
 *   3. Se `mailService` retornar `success: false` / `dispatched: false` sem lançar exceção (após suas 3 tentativas
 *      internas de SMTP), a claim é mantida no banco para evitar tempestade de retentativas (retry storm).
 *   4. Quando `total = 0` (nenhum documento crítico ou vencido), o e-mail não é enviado (`dispatched: false`,
 *      `success: true`), mas a claim do dia civil é mantida: a verificação diária da meia-noite já foi concluída
 *      e réplicas que disparem segundos depois não precisam repetir a etapa de digest naquele mesmo dia.
 */
export async function executeDailyJob(): Promise<DailyJobExecutionResult> {
  try {
    console.log('[Scheduler] Iniciando verificação de lock para execução do job diário...');

    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${DAILY_JOB_LOCK_KEY}) AS locked`;

        if (!rows || !rows[0] || !rows[0].locked) {
          console.log('[Scheduler] Lock consultivo não adquirido (outra instância já em execução). Job diário ignorado.');
          return { skipped: true as const };
        }

        console.log('[Scheduler] Lock adquirido com sucesso. Executando recalculateAllStatuses...');
        const recalculateResult = await recalculateAllStatuses();
        console.log(
          `[Scheduler] Recálculo concluído: ${recalculateResult.totalProcessed} processados, ${recalculateResult.updatedCount} atualizados, ${recalculateResult.alertsSent} enviados, ${recalculateResult.alertsFailed} falhos.`
        );

        const runDate = getBusinessToday();
        const claim = await tx.jobRun.createMany({
          data: [{ job: DAILY_DIGEST_JOB_NAME, runDate }],
          skipDuplicates: true,
        });

        if (claim.count === 0) {
          console.log(
            `[Scheduler] Daily Digest já reivindicado para a data civil ${runDate.toISOString().slice(0, 10)}. Envio ignorado.`
          );
          return { skipped: true as const };
        }

        console.log('[Scheduler] Executando runDailyDigestJob...');
        const digestResult = await runDailyDigestJob();
        console.log(
          `[Scheduler] Daily Digest concluído: ${digestResult.total} documentos pendentes, enviado=${digestResult.dispatched}.`
        );

        return {
          skipped: false as const,
          recalculateResult,
          digestResult,
        };
      },
      { timeout: 10 * 60 * 1000, maxWait: 10_000 }
    );

    return result;
  } catch (error) {
    console.error('[Scheduler] Erro durante a execução do job diário:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Inicia o agendamento in-process diário à meia-noite (00:00) no fuso da aplicação.
 * Retorna null se CRON_ENABLED for falso ou NODE_ENV for test.
 */
export function startScheduler(): ScheduledTask | null {
  if (!env.CRON_ENABLED || env.NODE_ENV === 'test') {
    return null;
  }

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const timezone = getAppTimeZone();
  const task = cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        await executeDailyJob();
      } catch (err) {
        console.error('[Scheduler] Erro inesperado no callback do cron:', err);
      }
    },
    {
      timezone,
    }
  );

  scheduledTask = task;
  console.log(`[Scheduler] Agendador ativado: 0 0 * * * (fuso: ${timezone})`);
  return task;
}

/**
 * Para o agendador caso esteja ativo.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Agendador desativado.');
  }
}
