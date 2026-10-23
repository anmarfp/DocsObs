import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { Role, SyncStatus } from '@prisma/client';

const mockGenerateAuthUrl = vi.fn();
const mockGetToken = vi.fn();
const mockRevokeToken = vi.fn();
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
          generateAuthUrl: mockGenerateAuthUrl,
          getToken: mockGetToken,
          revokeToken: mockRevokeToken,
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

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  const env = { ...actual.env };
  return { ...actual, env };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    googleOAuthToken: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    gCalSyncLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';
import { generateToken, signOAuthState } from '../src/utils/jwt.js';
import {
  decryptSecret,
  ENCRYPTED_TOKEN_PREFIX,
  encryptSecret,
} from '../src/utils/tokenCrypto.js';
import { encryptLegacyGoogleTokens } from '../src/services/googleTokenStore.js';
import { deleteDocumentEvent, syncDocumentEvent } from '../src/services/gcalService.js';

describe('DOC-44 - Criptografia em repouso dos tokens OAuth do Google (AES-256-GCM)', () => {
  const keyA = crypto.randomBytes(32).toString('base64');
  const keyB = crypto.randomBytes(32).toString('base64');
  const defaultEnv = { ...env };

  const adminJwt = generateToken({
    userId: 'admin-1',
    email: 'admin1@docsobs.com',
    name: 'Admin Um',
    role: Role.ADMIN,
  });

  const sampleDoc = {
    id: 'doc-1',
    title: 'Alvará de Funcionamento',
    expirationDate: new Date('2026-10-30T00:00:00.000Z'),
    createdById: 'admin-1',
  };

  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    Object.assign(env, defaultEnv);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(env, defaultEnv);
    (env as any).GOOGLE_TOKEN_ENCRYPTION_KEY = keyA;
    (env as any).google = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:3001/api/v1/calendar/google/callback',
    };
    (prisma.gCalSyncLog.findMany as any).mockResolvedValue([]);
    (prisma.gCalSyncLog.create as any).mockResolvedValue({ id: 'sync-log-1' });
  });

  afterEach(() => {
    Object.assign(env, defaultEnv);
  });

  it('cifrar o mesmo texto puro duas vezes gera ciphertexts diferentes (IV aleatório) e ambos decifram para o original', () => {
    const plain = 'ya29.a0AfH6SMBx-plain-secret-token';
    const first = encryptSecret(plain);
    const second = encryptSecret(plain);

    expect(first.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(second.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(first).not.toBe(second);

    // Formato enc:v1:<iv>:<tag>:<ciphertext>
    const parts = first.slice(ENCRYPTED_TOKEN_PREFIX.length).split(':');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], 'base64url').length).toBe(12);
    expect(Buffer.from(parts[1], 'base64url').length).toBe(16);

    expect(decryptSecret(first)).toBe(plain);
    expect(decryptSecret(second)).toBe(plain);
  });

  it('no callback OAuth com access_token e refresh_token, grava ambos como enc:v1:... diferentes do texto puro', async () => {
    const state = signOAuthState('admin-1');
    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);
    (prisma.googleOAuthToken.upsert as any).mockResolvedValue({ id: 'token-1' });
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'plain-access-oauth',
        refresh_token: 'plain-refresh-oauth',
        expiry_date: Date.now() + 3600 * 1000,
        scope: 'https://www.googleapis.com/auth/calendar.events',
      },
    });

    const res = await request(app)
      .get('/api/v1/calendar/google/callback')
      .query({ code: 'oauth-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=connected');

    const upsertArg = (prisma.googleOAuthToken.upsert as any).mock.calls[0][0];
    expect(upsertArg.create.accessToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(upsertArg.create.refreshToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(upsertArg.create.accessToken).not.toContain('plain-access-oauth');
    expect(upsertArg.create.refreshToken).not.toContain('plain-refresh-oauth');
    expect(decryptSecret(upsertArg.create.accessToken)).toBe('plain-access-oauth');
    expect(decryptSecret(upsertArg.create.refreshToken)).toBe('plain-refresh-oauth');
  });

  it('no evento tokens com apenas novo access_token, atualiza somente accessToken cifrado', async () => {
    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
      id: 'token-1',
      userId: 'admin-1',
      accessToken: encryptSecret('access-inicial'),
      refreshToken: encryptSecret('refresh-inicial'),
      expiryDate: new Date(Date.now() + 3600 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });
    (prisma.googleOAuthToken.update as any).mockResolvedValue({ id: 'token-1' });
    mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-evt-1' } });

    await syncDocumentEvent(sampleDoc);

    const [, onTokens] = mockOn.mock.calls[0];
    onTokens({ access_token: 'access-renovado-unico' });

    expect(prisma.googleOAuthToken.update).toHaveBeenCalledTimes(1);
    const updateArg = (prisma.googleOAuthToken.update as any).mock.calls[0][0];
    expect(updateArg.where).toEqual({ userId: 'admin-1' });
    expect(updateArg.data.accessToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(updateArg.data.accessToken).not.toContain('access-renovado-unico');
    expect(decryptSecret(updateArg.data.accessToken)).toBe('access-renovado-unico');
    expect(updateArg.data.refreshToken).toBeUndefined();
    expect(updateArg.data.expiryDate).toBeUndefined();
  });

  it('no sync com linha cifrada, o cliente OAuth recebe os tokens em texto puro descriptografados', async () => {
    const expiry = new Date(Date.now() + 3600 * 1000);
    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
      id: 'token-1',
      userId: 'admin-1',
      accessToken: encryptSecret('access-decifrado-sync'),
      refreshToken: encryptSecret('refresh-decifrado-sync'),
      expiryDate: expiry,
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });
    mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-evt-2' } });

    const result = await syncDocumentEvent(sampleDoc);

    expect(result.status).toBe(SyncStatus.SYNCED);
    expect(mockSetCredentials).toHaveBeenCalledWith({
      access_token: 'access-decifrado-sync',
      refresh_token: 'refresh-decifrado-sync',
      expiry_date: expiry.getTime(),
    });
  });

  it('no sync com linha legada em texto puro, funciona e repassa os valores em texto puro', async () => {
    const expiry = new Date(Date.now() + 3600 * 1000);
    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
      id: 'token-legacy',
      userId: 'admin-1',
      accessToken: 'legacy-plain-access',
      refreshToken: 'legacy-plain-refresh',
      expiryDate: expiry,
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });
    mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-evt-legacy' } });

    const result = await syncDocumentEvent(sampleDoc);

    expect(result.status).toBe(SyncStatus.SYNCED);
    expect(mockSetCredentials).toHaveBeenCalledWith({
      access_token: 'legacy-plain-access',
      refresh_token: 'legacy-plain-refresh',
      expiry_date: expiry.getTime(),
    });
  });

  it('backfill no boot com 2 linhas legadas e 1 já cifrada: atualiza 2, mantém a cifrada intocada e na 2ª execução atualiza 0', async () => {
    const alreadyEncryptedAccess = encryptSecret('already-enc-access');
    const alreadyEncryptedRefresh = encryptSecret('already-enc-refresh');

    const dbRows = [
      {
        id: 'row-legacy-1',
        userId: 'user-1',
        accessToken: 'plain-access-1',
        refreshToken: 'plain-refresh-1',
      },
      {
        id: 'row-legacy-partial',
        userId: 'user-2',
        accessToken: encryptSecret('already-enc-user-2'),
        refreshToken: 'plain-refresh-2',
      },
      {
        id: 'row-encrypted',
        userId: 'user-3',
        accessToken: alreadyEncryptedAccess,
        refreshToken: alreadyEncryptedRefresh,
      },
    ];

    (prisma.googleOAuthToken.findMany as any).mockImplementation(async () =>
      dbRows.map((r) => ({ ...r }))
    );
    (prisma.googleOAuthToken.update as any).mockImplementation(async ({ where, data }: any) => {
      const target = dbRows.find((r) => r.id === where.id);
      if (target) {
        Object.assign(target, data);
      }
      return target;
    });

    // 1ª execução: migra as 2 linhas com campos legados
    const firstCount = await encryptLegacyGoogleTokens();
    expect(firstCount).toBe(2);
    expect(prisma.googleOAuthToken.update).toHaveBeenCalledTimes(2);

    // Linha 1 teve ambos os campos cifrados
    expect(dbRows[0].accessToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(dbRows[0].refreshToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(decryptSecret(dbRows[0].accessToken)).toBe('plain-access-1');
    expect(decryptSecret(dbRows[0].refreshToken)).toBe('plain-refresh-1');

    // Linha 2 (parcial) só atualizou refreshToken; accessToken já cifrado não foi regravado
    const secondRowUpdate = (prisma.googleOAuthToken.update as any).mock.calls.find(
      ([call]: any) => call.where.id === 'row-legacy-partial'
    )[0];
    expect(secondRowUpdate.data.accessToken).toBeUndefined();
    expect(secondRowUpdate.data.refreshToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
    expect(decryptSecret(dbRows[1].refreshToken)).toBe('plain-refresh-2');

    // Linha 3 (já cifrada) permaneceu intocada
    expect(dbRows[2].accessToken).toBe(alreadyEncryptedAccess);
    expect(dbRows[2].refreshToken).toBe(alreadyEncryptedRefresh);

    // Nenhum log contém valores de tokens
    const allLogs = logSpy.mock.calls.flat().join(' ');
    expect(allLogs).not.toContain('plain-access-1');
    expect(allLogs).not.toContain('plain-refresh-1');
    expect(allLogs).not.toContain('plain-refresh-2');

    // 2ª execução: idempotente, atualiza 0 linhas
    (prisma.googleOAuthToken.update as any).mockClear();
    const secondCount = await encryptLegacyGoogleTokens();
    expect(secondCount).toBe(0);
    expect(prisma.googleOAuthToken.update).not.toHaveBeenCalled();
  });

  it('quando o token está cifrado com chave incorreta ou tag adulterada: trata como não conectado em sync, deleteEvent, status e revoke, sem estourar exceção nem logar o token/chave', async () => {
    const secretAccess = 'secret-access-never-log-me';
    const secretRefresh = 'secret-refresh-never-log-me';
    const encryptedWithKeyA = {
      id: 'token-1',
      userId: 'admin-1',
      accessToken: encryptSecret(secretAccess, keyA),
      refreshToken: encryptSecret(secretRefresh, keyA),
      expiryDate: new Date(Date.now() + 3600 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
    };

    // Troca a chave ativa para keyB (chave errada)
    (env as any).GOOGLE_TOKEN_ENCRYPTION_KEY = keyB;
    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(encryptedWithKeyA);
    (prisma.googleOAuthToken.delete as any).mockResolvedValue({ id: 'token-1' });

    // 1. Sync trata como não conectado (gcal_sync_logs ERROR) e não chama Google
    const syncRes = await syncDocumentEvent(sampleDoc);
    expect(syncRes.status).toBe(SyncStatus.ERROR);
    expect(syncRes.errorMessage).toMatch(/não conectou/i);
    expect(mockEventsInsert).not.toHaveBeenCalled();

    // 2. deleteDocumentEvent trata como não conectado quando há evento ativo
    (prisma.gCalSyncLog.findMany as any).mockResolvedValueOnce([
      { id: 'log-1', documentId: sampleDoc.id, gcalEventId: 'evt-1', status: SyncStatus.SYNCED, lastSyncedAt: new Date() },
    ]);
    const deleteRes = await deleteDocumentEvent(sampleDoc);
    expect(deleteRes.status).toBe(SyncStatus.ERROR);
    expect(mockEventsDelete).not.toHaveBeenCalled();

    // 3. Status retorna connected: false com 200 (nenhum erro escapa para a request)
    const statusRes = await request(app)
      .get('/api/v1/calendar/google/status')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual({ connected: false });

    // 4. Tampered auth tag com a chave correta (keyA) também é tratado como não conectado e no revoke apaga localmente sem chamar o Google
    (env as any).GOOGLE_TOKEN_ENCRYPTION_KEY = keyA;
    const validCipher = encryptSecret(secretAccess, keyA);
    const [ivPart, tagPart, cipherPart] = validCipher.slice(ENCRYPTED_TOKEN_PREFIX.length).split(':');
    const flippedChar = tagPart[0] === 'A' ? 'B' : 'A';
    const tamperedCipher = `${ENCRYPTED_TOKEN_PREFIX}${ivPart}:${flippedChar}${tagPart.slice(1)}:${cipherPart}`;

    (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
      ...encryptedWithKeyA,
      accessToken: tamperedCipher,
    });

    const revokeRes = await request(app)
      .delete('/api/v1/calendar/google/status')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body).toEqual({ connected: false });
    expect(mockRevokeToken).not.toHaveBeenCalled();
    expect(prisma.googleOAuthToken.delete).toHaveBeenCalledWith({ where: { userId: 'admin-1' } });

    // 5. Verifica que nenhum log de erro contém os valores dos tokens (nem cifrados nem puros) ou as chaves
    const errorLogs = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(errorLogs).not.toContain(secretAccess);
    expect(errorLogs).not.toContain(secretRefresh);
    expect(errorLogs).not.toContain(encryptedWithKeyA.accessToken);
    expect(errorLogs).not.toContain(tamperedCipher);
    expect(errorLogs).not.toContain(keyA);
    expect(errorLogs).not.toContain(keyB);
  });
});
