import { SyncStatus } from '@prisma/client';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

/**
 * Sincronização real com o Google Agenda (ADR-009 / DOC-28, subtarefa 3).
 *
 * Modelo de conta: OAuth por usuário (ADR-009). Cada documento é sincronizado na
 * agenda do usuário que o cadastrou (`document.createdById`), pois `Document` não
 * tem hoje um campo separado para "dono da agenda" — `createdById` é o único
 * vínculo disponível e é o mesmo já usado no restante do sistema (ex.: auditoria).
 * Se esse usuário nunca conectou sua conta Google (sem linha em
 * `GoogleOAuthToken`), a sincronização falha com `SyncStatus.ERROR` em vez de
 * tentar qualquer chamada de rede.
 */

export interface SyncDocumentEventResult {
  documentId: string;
  gcalEventId?: string;
  status: SyncStatus;
  errorMessage?: string;
}

export interface SyncAllResult {
  total: number;
  synced: number;
}

interface SyncableDocument {
  id: string;
  title: string;
  expirationDate?: Date | string | null;
  createdById: string;
}

const CALENDAR_ID = 'primary';
const NOT_CONNECTED_MESSAGE = 'Usuário não conectou o Google Agenda.';

function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.google?.clientId,
    env.google?.clientSecret,
    env.google?.redirectUri
  );
}

/**
 * Monta um cliente OAuth2 autenticado com o token salvo do usuário e registra o
 * listener `tokens` da própria lib `googleapis`: quando ela renova o
 * `access_token` automaticamente (usando o `refresh_token`) durante uma chamada
 * da API, esse evento dispara e persistimos a renovação em `GoogleOAuthToken`
 * para que a próxima sincronização não precise renovar de novo.
 */
function buildAuthenticatedOAuth2Client(
  userId: string,
  token: { accessToken: string; refreshToken: string; expiryDate: Date }
) {
  const oauth2Client = createOAuth2Client();

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiryDate.getTime(),
  });

  oauth2Client.on('tokens', (tokens) => {
    const data: { accessToken?: string; refreshToken?: string; expiryDate?: Date } = {};

    if (tokens.access_token) {
      data.accessToken = tokens.access_token;
    }
    if (tokens.refresh_token) {
      data.refreshToken = tokens.refresh_token;
    }
    if (tokens.expiry_date) {
      data.expiryDate = new Date(tokens.expiry_date);
    }

    if (Object.keys(data).length === 0) {
      return;
    }

    prisma.googleOAuthToken.update({ where: { userId }, data }).catch((error) => {
      console.error('Falha ao persistir renovação automática do token do Google Agenda:', error);
    });
  });

  return oauth2Client;
}

function toDateOnly(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toISOString().slice(0, 10);
}

/** Soma dias a uma data "YYYY-MM-DD" mantendo o formato (usado para o fim exclusivo de eventos de dia inteiro). */
function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function extractGoogleErrorReason(error: any): string {
  const reason =
    error?.response?.data?.error?.errors?.[0]?.reason ??
    error?.errors?.[0]?.reason ??
    error?.response?.data?.error ??
    '';
  return typeof reason === 'string' ? reason.toLowerCase() : '';
}

function extractStatusCode(error: any): number | undefined {
  return error?.response?.status ?? error?.code ?? error?.status;
}

/**
 * Traduz um erro real da API/lib do Google em uma mensagem específica e útil
 * para `GCalSyncLog.errorMessage` — nunca uma string genérica (item de escopo
 * "Tratamento real de erro" do DOC-28).
 */
function classifyGoogleError(error: unknown): string {
  const err = error as any;
  const message: string = typeof err?.message === 'string' ? err.message : '';
  const lowerMessage = message.toLowerCase();
  const reason = extractGoogleErrorReason(err);
  const status = extractStatusCode(err);

  const isInvalidGrant =
    reason.includes('invalid_grant') ||
    lowerMessage.includes('invalid_grant') ||
    lowerMessage.includes('invalid_token') ||
    status === 401;

  if (isInvalidGrant) {
    return 'A autorização do Google Agenda expirou ou foi revogada. Reconecte a conta em Configurações.';
  }

  const isRateLimited =
    status === 429 ||
    (status === 403 &&
      ['ratelimitexceeded', 'userratelimitexceeded', 'quotaexceeded', 'dailylimitexceeded'].includes(reason)) ||
    ['ratelimitexceeded', 'userratelimitexceeded', 'quotaexceeded', 'dailylimitexceeded'].includes(reason);

  if (isRateLimited) {
    return 'Limite de requisições da API do Google Agenda foi atingido (rate limit/quota). Tente sincronizar novamente mais tarde.';
  }

  const networkCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
  const isNetworkFailure =
    networkCodes.includes(err?.code) || lowerMessage.includes('network');

  if (isNetworkFailure) {
    return 'Falha de rede ao chamar a API do Google Agenda. Tente sincronizar novamente mais tarde.';
  }

  return `Erro ao sincronizar com a API do Google Agenda: ${message || 'erro desconhecido'}.`;
}

/**
 * Resolve o evento atualmente ativo no Google Agenda para um documento, olhando
 * apenas o registro `SYNCED`/`DELETED` mais recente (registros `ERROR` são
 * ignorados aqui: uma falha transitória não muda se o evento existe ou não).
 * Isso evita dois bugs opostos: (a) reaproveitar um evento já removido por um
 * `deleteDocumentEvent` posterior (causaria "update" num evento inexistente), e
 * (b) esquecer um evento que segue existindo só porque a tentativa mais recente
 * falhou (causaria "insert" duplicado numa próxima sincronização bem-sucedida).
 */
async function findCurrentGcalEventId(documentId: string): Promise<string | null> {
  const [mostRecent] = await prisma.gCalSyncLog.findMany({
    where: { documentId, status: { in: [SyncStatus.SYNCED, SyncStatus.DELETED] } },
    orderBy: { lastSyncedAt: 'desc' },
    take: 1,
  });

  if (!mostRecent || mostRecent.status === SyncStatus.DELETED) {
    return null;
  }

  return mostRecent.gcalEventId ?? null;
}

/**
 * Sincroniza um documento específico com o Google Agenda e registra o log de sincronização (RF-005 / RN-007).
 */
export async function syncDocumentEvent(
  doc: SyncableDocument,
  _action: string = 'sync'
): Promise<SyncDocumentEventResult> {
  if (!doc.expirationDate) {
    const errorMessage = 'Documento sem data de vencimento para sincronização no Google Agenda.';
    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        status: SyncStatus.ERROR,
        errorMessage,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.ERROR,
      errorMessage,
    };
  }

  const token = await prisma.googleOAuthToken.findUnique({ where: { userId: doc.createdById } });

  if (!token) {
    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        status: SyncStatus.ERROR,
        errorMessage: NOT_CONNECTED_MESSAGE,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.ERROR,
      errorMessage: NOT_CONNECTED_MESSAGE,
    };
  }

  const oauth2Client = buildAuthenticatedOAuth2Client(doc.createdById, token);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Evento de dia inteiro no dia do vencimento. A API do Google Agenda usa `end`
  // exclusivo para eventos de dia inteiro, então soma-se 1 dia ao `start`.
  const startDate = toDateOnly(doc.expirationDate);
  const endDate = addDays(startDate, 1);
  const requestBody = {
    summary: doc.title,
    start: { date: startDate },
    end: { date: endDate },
  };

  const currentEventId = await findCurrentGcalEventId(doc.id);

  try {
    let gcalEventId: string | null | undefined;

    if (currentEventId) {
      const response = await calendar.events.update({
        calendarId: CALENDAR_ID,
        eventId: currentEventId,
        requestBody,
      });
      gcalEventId = response.data.id ?? currentEventId;
    } else {
      const response = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody,
      });
      gcalEventId = response.data.id;
    }

    if (!gcalEventId) {
      throw new Error('A API do Google Agenda não retornou um identificador de evento.');
    }

    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        gcalEventId,
        status: SyncStatus.SYNCED,
      },
    });

    return {
      documentId: doc.id,
      gcalEventId,
      status: SyncStatus.SYNCED,
    };
  } catch (error) {
    const errorMessage = classifyGoogleError(error);

    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        status: SyncStatus.ERROR,
        errorMessage,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.ERROR,
      errorMessage,
    };
  }
}

/**
 * Remove/cancela o evento do Google Agenda de um documento (ex.: ao arquivar ou
 * excluir um documento — disparo automático fica a cargo da subtarefa 4). Reusa o
 * mesmo critério de busca do último evento sincronizado; se não houver nenhum
 * evento real registrado, não há nada para cancelar e a função retorna sem
 * chamar a API nem gravar um novo log.
 *
 * Escolha de modelagem: em vez de forçar `SYNCED`/`ERROR` para representar "evento
 * removido", foi adicionado um terceiro valor ao enum `SyncStatus` (`DELETED`,
 * migration `20260830203917_add_sync_status_deleted`) — mais claro para quem lê
 * `gcal_sync_logs` do que reaproveitar `SYNCED` com `gcalEventId: null`.
 */
export async function deleteDocumentEvent(
  doc: { id: string; createdById: string }
): Promise<SyncDocumentEventResult> {
  const currentEventId = await findCurrentGcalEventId(doc.id);

  if (!currentEventId) {
    return {
      documentId: doc.id,
      status: SyncStatus.DELETED,
    };
  }

  const token = await prisma.googleOAuthToken.findUnique({ where: { userId: doc.createdById } });

  if (!token) {
    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        status: SyncStatus.ERROR,
        errorMessage: NOT_CONNECTED_MESSAGE,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.ERROR,
      errorMessage: NOT_CONNECTED_MESSAGE,
    };
  }

  const oauth2Client = buildAuthenticatedOAuth2Client(doc.createdById, token);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: currentEventId,
    });

    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        gcalEventId: null,
        status: SyncStatus.DELETED,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.DELETED,
    };
  } catch (error) {
    const errorMessage = classifyGoogleError(error);

    await prisma.gCalSyncLog.create({
      data: {
        documentId: doc.id,
        status: SyncStatus.ERROR,
        errorMessage,
      },
    });

    return {
      documentId: doc.id,
      status: SyncStatus.ERROR,
      errorMessage,
    };
  }
}

/**
 * Sincroniza em lote todos os documentos ativos que possuem data de vencimento com o Google Agenda (RF-005).
 */
export async function syncAllDocuments(): Promise<SyncAllResult> {
  const documents = await prisma.document.findMany({
    where: {
      isArchived: false,
      expirationDate: { not: null },
    },
  });

  let synced = 0;
  for (const doc of documents) {
    const result = await syncDocumentEvent(doc, 'sync');
    if (result.status === SyncStatus.SYNCED) {
      synced++;
    }
  }

  return {
    total: documents.length,
    synced,
  };
}
