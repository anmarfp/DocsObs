import { prisma } from '../lib/prisma.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../utils/tokenCrypto.js';

export interface DecryptedGoogleOAuthToken {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope: string;
}

export interface SaveGoogleOAuthTokensParams {
  userId: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expiryDate: Date;
  scope: string;
}

export interface RefreshGoogleOAuthTokensParams {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

export interface RevokeLookupResult {
  hasStoredRow: boolean;
  tokenToRevoke: string | null;
}

function isEncryptedOrCorruptedPrefix(value: string): boolean {
  return value.startsWith('enc:');
}

/**
 * Persiste (upsert) os tokens recebidos no callback OAuth do Google, sempre
 * cifrando `accessToken` e `refreshToken` com AES-256-GCM antes de gravar.
 * Retorna `false` quando não há `refresh_token` novo nem um registro anterior
 * legível para reaproveitar.
 */
export async function saveGoogleOAuthTokens(
  params: SaveGoogleOAuthTokensParams
): Promise<boolean> {
  const existing = await prisma.googleOAuthToken.findUnique({
    where: { userId: params.userId },
  });

  if (!params.refresh_token && !existing) {
    return false;
  }

  let fallbackAccessPlain = '';
  let fallbackRefreshPlain = '';

  if (existing) {
    try {
      if (typeof existing.accessToken === 'string') {
        fallbackAccessPlain = decryptSecret(existing.accessToken);
      }
      if (!params.refresh_token && typeof existing.refreshToken === 'string') {
        fallbackRefreshPlain = decryptSecret(existing.refreshToken);
      }
    } catch {
      console.error(
        '[DocsObs] Falha ao descriptografar token OAuth existente do Google durante reconexão.'
      );
      if (!params.refresh_token) {
        return false;
      }
    }
  }

  const accessTokenPlain = params.access_token || fallbackAccessPlain || '';
  const encryptedAccessToken = encryptSecret(accessTokenPlain);
  const encryptedRefreshToken = params.refresh_token
    ? encryptSecret(params.refresh_token)
    : encryptSecret(fallbackRefreshPlain);

  await prisma.googleOAuthToken.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiryDate: params.expiryDate,
      scope: params.scope,
    },
    update: {
      accessToken: encryptedAccessToken,
      ...(params.refresh_token ? { refreshToken: encryptedRefreshToken } : {}),
      expiryDate: params.expiryDate,
      scope: params.scope,
    },
  });

  return true;
}

/**
 * Atualiza apenas os campos presentes no evento `tokens` disparado pela
 * renovação automática do `OAuth2Client`, cifrando qualquer token alterado.
 */
export async function updateRefreshedGoogleTokens(
  userId: string,
  tokens: RefreshGoogleOAuthTokensParams
): Promise<void> {
  const data: { accessToken?: string; refreshToken?: string; expiryDate?: Date } = {};

  if (tokens.access_token) {
    data.accessToken = encryptSecret(tokens.access_token);
  }
  if (tokens.refresh_token) {
    data.refreshToken = encryptSecret(tokens.refresh_token);
  }
  if (tokens.expiry_date) {
    data.expiryDate = new Date(tokens.expiry_date);
  }

  if (Object.keys(data).length === 0) {
    return;
  }

  await prisma.googleOAuthToken.update({
    where: { userId },
    data,
  });
}

/**
 * Lê e descriptografa os tokens OAuth do usuário para sincronização com o
 * Google Agenda. Aceita valores legados em texto puro (sem prefixo `enc:v1:`).
 * Se o valor estiver corrompido ou cifrado com outra chave, registra um único
 * erro sem expor o valor e retorna `null` (tratando o usuário como desconectado).
 */
export async function getDecryptedGoogleTokens(
  userId: string
): Promise<DecryptedGoogleOAuthToken | null> {
  const row = await prisma.googleOAuthToken.findUnique({
    where: { userId },
  });

  if (!row) {
    return null;
  }

  try {
    const decryptedAccess = decryptSecret(row.accessToken);
    const decryptedRefresh = decryptSecret(row.refreshToken);

    return {
      access_token: decryptedAccess,
      refresh_token: decryptedRefresh,
      expiry_date: row.expiryDate.getTime(),
      scope: row.scope,
    };
  } catch {
    console.error(
      `[DocsObs] Falha ao descriptografar token OAuth do Google (userId=${userId}). Tratando conta como não conectada.`
    );
    return null;
  }
}

/**
 * Verifica se o usuário possui uma conexão Google OAuth ativa e legível sem
 * expor valores de token. Linhas legadas (ou mocks que selecionam apenas `id`)
 * não precisam ser descriptografadas; linhas cifradas ilegíveis (chave incorreta
 * ou tag adulterada) são tratadas como não conectadas.
 */
export async function isGoogleAccountConnected(userId: string): Promise<boolean> {
  const row = await prisma.googleOAuthToken.findUnique({
    where: { userId },
  });

  if (!row) {
    return false;
  }

  try {
    if (typeof row.accessToken === 'string' && isEncryptedOrCorruptedPrefix(row.accessToken)) {
      decryptSecret(row.accessToken);
    }
    if (typeof row.refreshToken === 'string' && isEncryptedOrCorruptedPrefix(row.refreshToken)) {
      decryptSecret(row.refreshToken);
    }
    return true;
  } catch {
    console.error(
      `[DocsObs] Token OAuth do Google ilegível ao consultar status (userId=${userId}). Tratando conta como não conectada.`
    );
    return false;
  }
}

/**
 * Obtém o token descriptografado para revogação junto ao Google.
 * Se o registro existir mas o token for indecifrável, registra um único erro
 * sem o valor e retorna `{ hasStoredRow: true, tokenToRevoke: null }` para que o
 * chamador apague o registro local sem chamar o Google.
 */
export async function getGoogleTokenForRevoke(userId: string): Promise<RevokeLookupResult> {
  const row = await prisma.googleOAuthToken.findUnique({
    where: { userId },
  });

  if (!row) {
    return { hasStoredRow: false, tokenToRevoke: null };
  }

  try {
    const tokenToRevoke = decryptSecret(row.accessToken);
    if (typeof row.refreshToken === 'string') {
      decryptSecret(row.refreshToken);
    }
    return { hasStoredRow: true, tokenToRevoke };
  } catch {
    console.error(
      `[DocsObs] Falha ao descriptografar token OAuth do Google na desconexão (userId=${userId}). Removendo registro local sem chamar o Google.`
    );
    return { hasStoredRow: true, tokenToRevoke: null };
  }
}

export async function deleteGoogleOAuthToken(userId: string): Promise<void> {
  await prisma.googleOAuthToken.delete({
    where: { userId },
  });
}

/**
 * Backfill idempotente executado no boot: cifra todos os registros legados em
 * `google_oauth_tokens` cujos campos `accessToken` ou `refreshToken` ainda não
 * possuam o prefixo `enc:v1:`. Atualiza apenas os campos em texto puro,
 * registra somente a contagem de linhas migradas e nunca derruba o servidor em
 * caso de falha.
 */
export async function encryptLegacyGoogleTokens(): Promise<number> {
  try {
    const rows = await prisma.googleOAuthToken.findMany();
    let migratedCount = 0;

    for (const row of rows) {
      const data: { accessToken?: string; refreshToken?: string } = {};

      if (typeof row.accessToken === 'string' && !isEncryptedSecret(row.accessToken)) {
        data.accessToken = encryptSecret(row.accessToken);
      }
      if (typeof row.refreshToken === 'string' && !isEncryptedSecret(row.refreshToken)) {
        data.refreshToken = encryptSecret(row.refreshToken);
      }

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.googleOAuthToken.update({
        where: row.id ? { id: row.id } : { userId: row.userId },
        data,
      });
      migratedCount++;
    }

    console.log(
      `🔒 [DocsObs] Backfill de criptografia de tokens OAuth do Google concluído: ${migratedCount} registro(s) migrado(s).`
    );
    return migratedCount;
  } catch (error) {
    console.error(
      '[DocsObs] Falha ao criptografar tokens OAuth legados do Google no boot:',
      error instanceof Error ? error.message : 'erro desconhecido'
    );
    return 0;
  }
}
