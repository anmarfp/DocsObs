import { DocumentStatus, NotificationMode } from '@prisma/client';
import { sendMail } from './mailService.js';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role?: string;
  isActive?: boolean;
}

export interface CompanyConfigSummary {
  id?: string;
  notificationMode: NotificationMode;
}

export interface DocumentNotificationData {
  id: string;
  title: string;
  expirationDate?: Date | string | null;
  status: DocumentStatus;
  responsibleName?: string | null;
  responsibleEmail?: string | null;
  category?: {
    id: string;
    name: string;
    colorHex?: string | null;
  } | null;
}

export interface ExpirationAlertResult {
  success: boolean;
  dispatched: boolean;
  error?: string;
  documentId: string;
  status: DocumentStatus;
  recipients: string[];
  subject: string;
  body: string;
  sentAt: Date;
}

export interface DailyDigestSummary {
  critical: DocumentNotificationData[];
  expired: DocumentNotificationData[];
  total: number;
}

export interface DailyDigestResult {
  success: boolean;
  dispatched: boolean;
  error?: string;
  recipients: string[];
  subject: string;
  total: number;
  summary: DailyDigestSummary;
  sentAt: Date;
}

/**
 * Resolve os destinatários de notificação com base no modo de notificação da empresa (RF-012 / RN-004):
 * - ALL_ADMINS: retorna os e-mails de todos os administradores ativos.
 * - ONLY_RESPONSIBLE: retorna apenas o e-mail do responsável pelo documento.
 */
export function resolveNotificationRecipients(
  doc: { responsibleEmail?: string | null },
  config: { notificationMode?: NotificationMode | null } | null,
  admins: Array<{ email: string; isActive?: boolean }>
): string[] {
  const mode = config?.notificationMode || NotificationMode.ALL_ADMINS;

  if (mode === NotificationMode.ONLY_RESPONSIBLE) {
    if (doc?.responsibleEmail && doc.responsibleEmail.trim() !== '') {
      return [doc.responsibleEmail.trim()];
    }
    return [];
  }

  // ALL_ADMINS
  return admins
    .filter((admin) => admin.isActive !== false && Boolean(admin.email))
    .map((admin) => admin.email.trim());
}

/**
 * Dispara alerta de vencimento de documento via e-mail real (RF-007 / RN-003).
 */
export async function sendExpirationAlert(
  doc: DocumentNotificationData,
  recipients: string[],
  isCritical: boolean
): Promise<ExpirationAlertResult> {
  const isExpired = doc.status === DocumentStatus.EXPIRED || (!isCritical && doc.status !== DocumentStatus.CRITICAL);
  const statusLabel = isExpired ? 'Vencido' : 'Crítico';

  const subject = isExpired
    ? `[DocsObs] Documento Vencido: ${doc.title}`
    : `[DocsObs] Alerta Crítico de Vencimento: ${doc.title}`;

  const formattedDate = doc.expirationDate
    ? new Date(doc.expirationDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    : 'Data não informada';

  const body = `Olá,\n\nO documento "${doc.title}" está classificado com o status ${statusLabel.toUpperCase()} (Vencimento: ${formattedDate}).\nPor favor, tome as ações necessárias para regularização ou renovação no sistema DocsObs.`;

  let dispatched = false;
  let error: string | undefined;

  if (recipients.length === 0) {
    error = 'Nenhum destinatário informado para o alerta';
    console.error(`[DocsObs] ${error}`);
  } else {
    const mailResult = await sendMail({
      to: recipients,
      subject,
      text: body,
    });
    if (mailResult.dispatched) {
      dispatched = true;
    } else {
      dispatched = false;
      error = mailResult.error;
      console.error(`[DocsObs] Falha ao enviar alerta de vencimento para doc ${doc.id}: ${error}`);
    }
  }

  return {
    success: dispatched,
    dispatched,
    error,
    documentId: doc.id,
    status: doc.status,
    recipients,
    subject,
    body,
    sentAt: new Date(),
  };
}

/**
 * Dispara o Daily Digest consolidado para os administradores ativos (RF-008 / DOC-41).
 * Não envia o e-mail quando não há documentos pendentes (total === 0), sem contar como falha.
 */
export async function sendDailyDigest(
  admins: Array<{ email: string; isActive?: boolean }>,
  summary: DailyDigestSummary
): Promise<DailyDigestResult> {
  const recipients = admins
    .filter((admin) => admin.isActive !== false && Boolean(admin.email))
    .map((admin) => admin.email.trim());

  const subject = `[DocsObs] Resumo Diário de Vencimentos (Daily Digest) - ${summary.total} documento(s) pendente(s)`;

  if (summary.total === 0) {
    console.log('[DocsObs] Daily Digest ignorado: 0 documento(s) pendente(s).');
    return {
      success: true,
      dispatched: false,
      recipients,
      subject,
      total: 0,
      summary,
      sentAt: new Date(),
    };
  }

  const bodyLines: string[] = [
    `Olá,`,
    ``,
    `Este é o Resumo Diário de Vencimentos do DocsObs.`,
    `Total de documentos pendentes: ${summary.total}`,
    ``,
    `Documentos em Alerta Crítico (${summary.critical.length}):`,
    ...(summary.critical.length > 0
      ? summary.critical.map((d) => {
          const exp = d.expirationDate
            ? new Date(d.expirationDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : 'Data não informada';
          return `- ${d.title} (Vencimento: ${exp})`;
        })
      : ['- Nenhum documento crítico']),
    ``,
    `Documentos Vencidos (${summary.expired.length}):`,
    ...(summary.expired.length > 0
      ? summary.expired.map((d) => {
          const exp = d.expirationDate
            ? new Date(d.expirationDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : 'Data não informada';
          return `- ${d.title} (Vencimento: ${exp})`;
        })
      : ['- Nenhum documento vencido']),
    ``,
    `Por favor, acesse o DocsObs para tomar as providências necessárias.`,
  ];
  const body = bodyLines.join('\n');

  let dispatched = false;
  let error: string | undefined;

  if (recipients.length === 0) {
    error = 'Nenhum administrador ativo para receber o resumo diário';
    console.error(`[DocsObs] ${error}`);
  } else {
    const mailResult = await sendMail({
      to: recipients,
      subject,
      text: body,
    });
    if (mailResult.dispatched) {
      dispatched = true;
    } else {
      dispatched = false;
      error = mailResult.error;
      console.error(`[DocsObs] Falha ao enviar Daily Digest: ${error}`);
    }
  }

  return {
    success: dispatched,
    dispatched,
    error,
    recipients,
    subject,
    total: summary.total,
    summary,
    sentAt: new Date(),
  };
}
