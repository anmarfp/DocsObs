import { DocumentStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { calculateDocumentStatus } from './statusService.js';
import {
  resolveNotificationRecipients,
  sendExpirationAlert,
  sendDailyDigest,
} from './notificationService.js';

export interface RecalculateStatusesResult {
  totalProcessed: number;
  updatedCount: number;
  alertsSent: number;
  alertsFailed: number;
}

/**
 * Recalcula o status de todos os documentos ativos e dispara notificações para vencidos ou em alerta crítico (RN-001 / RN-003).
 * Preserva estados manuais como RENEWAL_IN_PROGRESS e documentos INDETERMINATE.
 */
export async function recalculateAllStatuses(baseDate?: Date): Promise<RecalculateStatusesResult> {
  const documents = await prisma.document.findMany({
    where: { isArchived: false },
  });

  const [config, admins] = await Promise.all([
    prisma.companyConfig.findFirst(),
    prisma.user.findMany({
      where: { role: Role.ADMIN, isActive: true },
    }),
  ]);

  let updatedCount = 0;
  let alertsSent = 0;
  let alertsFailed = 0;

  for (const doc of documents) {
    // Preserva estados manuais e documentos sem vencimento (permanentes)
    if (
      doc.status === DocumentStatus.RENEWAL_IN_PROGRESS ||
      doc.status === DocumentStatus.INDETERMINATE ||
      !doc.expirationDate
    ) {
      continue;
    }

    const newStatus = calculateDocumentStatus(
      doc.expirationDate,
      doc.alertLeadDays,
      false,
      baseDate
    );

    if (newStatus !== doc.status) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: newStatus },
      });
      updatedCount++;

      if (newStatus === DocumentStatus.CRITICAL || newStatus === DocumentStatus.EXPIRED) {
        const recipients = resolveNotificationRecipients(doc, config, admins);
        if (recipients.length > 0) {
          const alertResult = await sendExpirationAlert(
            { ...doc, status: newStatus },
            recipients,
            newStatus === DocumentStatus.CRITICAL
          );
          if (alertResult.dispatched) {
            alertsSent++;
          } else {
            alertsFailed++;
          }
        }
      }
    }
  }

  return {
    totalProcessed: documents.length,
    updatedCount,
    alertsSent,
    alertsFailed,
  };
}

/**
 * Executa o job diário de Daily Digest consolidando documentos críticos e vencidos para administradores (RF-008).
 */
export async function runDailyDigestJob(baseDate?: Date) {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
  });

  const documents = await prisma.document.findMany({
    where: {
      isArchived: false,
      status: {
        in: [DocumentStatus.CRITICAL, DocumentStatus.EXPIRED],
      },
    },
  });

  const critical = documents.filter((doc) => doc.status === DocumentStatus.CRITICAL);
  const expired = documents.filter((doc) => doc.status === DocumentStatus.EXPIRED);

  const summary = {
    critical,
    expired,
    total: critical.length + expired.length,
  };

  return await sendDailyDigest(admins, summary);
}
