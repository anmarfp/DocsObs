import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { getAppTimeZone } from '../utils/date.js';
import {
  recalculateAllStatuses,
  runDailyDigestJob,
  type RecalculateStatusesResult,
} from './cronService.js';
import type { DailyDigestResult } from './notificationService.js';

export const DAILY_JOB_LOCK_KEY = 26101431n;

let scheduledTask: ScheduledTask | null = null;

export type DailyJobExecutionResult =
  | { skipped: true }
  | { skipped: false; recalculateResult: RecalculateStatusesResult; digestResult: DailyDigestResult }
  | { error: string };

/**
 * Executa a rotina diária de recálculo e envio de digest, protegida por advisory lock transacional no PostgreSQL.
 * O lock impede execução concorrente por múltiplas réplicas da aplicação.
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
