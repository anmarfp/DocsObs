import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';

/**
 * Testes do fluxo de conexão OAuth por usuário com o Google Agenda (ADR-009 /
 * DOC-28, subtarefa 2; DOC-44 criptografia em repouso). A lib `googleapis` e o
 * `prisma` são mockados — nenhuma chamada de rede real ao Google acontece aqui.
 */

const mockGenerateAuthUrl = vi.fn();
const mockGetToken = vi.fn();
const mockRevokeToken = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // Precisa ser uma `function` "de verdade" (não arrow function): o
      // controller instancia com `new google.auth.OAuth2(...)`, e arrow
      // functions não são construtíveis. Retornar um objeto explicitamente faz
      // o `new` usar esse objeto como instância (semântica padrão de JS).
      OAuth2: vi.fn().mockImplementation(function GoogleOAuth2Mock() {
        return {
          generateAuthUrl: mockGenerateAuthUrl,
          getToken: mockGetToken,
          revokeToken: mockRevokeToken,
        };
      }),
    },
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
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';
import { generateToken, signOAuthState, verifyOAuthState } from '../src/utils/jwt.js';
import { decryptSecret, ENCRYPTED_TOKEN_PREFIX } from '../src/utils/tokenCrypto.js';

describe('Google Calendar OAuth - fluxo de conexão (DOC-28, subtarefa 2)', () => {
  const adminToken = generateToken({
    userId: 'admin-1', email: 'admin1@docsobs.com', name: 'Admin Um', role: Role.ADMIN,
  });
  const operationalToken = generateToken({
    userId: 'operational-1', email: 'operational@docsobs.com', name: 'Operacional', role: Role.OPERATIONAL,
  });

  const defaultEnv = { ...env };

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    Object.assign(env, defaultEnv);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(env, defaultEnv);
    (env as any).google = null;
  });

  afterEach(() => {
    Object.assign(env, defaultEnv);
  });

  function configureGoogleEnv() {
    (env as any).google = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3001/api/v1/calendar/google/callback',
    };
  }

  describe('GET /calendar/google/connect', () => {
    it('exige autenticação (401 sem token)', async () => {
      const res = await request(app).get('/api/v1/calendar/google/connect');
      expect(res.status).toBe(401);
    });

    it('retorna 503 GOOGLE_OAUTH_NOT_CONFIGURED quando as credenciais do Google não estão definidas', async () => {
      const res = await request(app)
        .get('/api/v1/calendar/google/connect')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(503);
      expect(res.body).toEqual(expect.objectContaining({ error: 'GOOGLE_OAUTH_NOT_CONFIGURED' }));
      expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
    });

    it('gera a URL de consentimento com state assinado contendo o userId do ADMIN autenticado', async () => {
      configureGoogleEnv();
      mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=1');

      const res = await request(app)
        .get('/api/v1/calendar/google/connect')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1' });

      expect(mockGenerateAuthUrl).toHaveBeenCalledTimes(1);
      const [callArgs] = mockGenerateAuthUrl.mock.calls[0];
      expect(callArgs).toEqual(expect.objectContaining({
        access_type: 'offline',
        prompt: 'consent',
        scope: expect.arrayContaining(['https://www.googleapis.com/auth/calendar.events']),
        state: expect.any(String),
      }));

      expect(verifyOAuthState(callArgs.state)).toBe('admin-1');
    });

    it('também permite o perfil OPERATIONAL', async () => {
      configureGoogleEnv();
      mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=2');

      const res = await request(app)
        .get('/api/v1/calendar/google/connect')
        .set('Authorization', `Bearer ${operationalToken}`);

      expect(res.status).toBe(200);
      const [callArgs] = mockGenerateAuthUrl.mock.calls[0];
      expect(verifyOAuthState(callArgs.state)).toBe('operational-1');
    });
  });

  describe('GET /calendar/google/callback', () => {
    it('não exige autenticação (rota pública para o redirect do Google) e redireciona com erro se faltar code/state', async () => {
      const res = await request(app).get('/api/v1/calendar/google/callback');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=error');
    });

    it('redireciona com erro quando o state é inválido/adulterado', async () => {
      configureGoogleEnv();

      const res = await request(app)
        .get('/api/v1/calendar/google/callback')
        .query({ code: 'auth-code', state: 'state-invalido-adulterado' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=error');
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('rejeita um token de login normal (Bearer) usado como state, mesmo assinado com o mesmo segredo', async () => {
      // Prova que `state` é um propósito distinto de `generateToken`: um token de
      // login válido não deve ser aceito como state só por compartilhar o segredo.
      configureGoogleEnv();

      const res = await request(app)
        .get('/api/v1/calendar/google/callback')
        .query({ code: 'auth-code', state: adminToken });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=error');
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('troca o code por tokens e cria o registro cifrado em GoogleOAuthToken na primeira conexão', async () => {
      configureGoogleEnv();
      const state = signOAuthState('admin-1');
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);
      (prisma.googleOAuthToken.upsert as any).mockResolvedValue({ id: 'token-1' });
      mockGetToken.mockResolvedValue({
        tokens: {
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-1',
          expiry_date: Date.now() + 3600 * 1000,
          scope: 'https://www.googleapis.com/auth/calendar.events',
        },
      });

      const res = await request(app)
        .get('/api/v1/calendar/google/callback')
        .query({ code: 'auth-code', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=connected');
      expect(mockGetToken).toHaveBeenCalledWith('auth-code');
      expect(prisma.googleOAuthToken.upsert).toHaveBeenCalledTimes(1);

      const upsertCall = (prisma.googleOAuthToken.upsert as any).mock.calls[0][0];
      expect(upsertCall.where).toEqual({ userId: 'admin-1' });
      expect(upsertCall.create.userId).toBe('admin-1');
      expect(upsertCall.create.accessToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
      expect(upsertCall.create.refreshToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
      expect(upsertCall.create.accessToken).not.toBe('access-token-1');
      expect(upsertCall.create.refreshToken).not.toBe('refresh-token-1');
      expect(decryptSecret(upsertCall.create.accessToken)).toBe('access-token-1');
      expect(decryptSecret(upsertCall.create.refreshToken)).toBe('refresh-token-1');
    });

    it('ao reconectar, preserva o refreshToken existente quando o Google não devolve um novo e cifra o novo accessToken', async () => {
      configureGoogleEnv();
      const state = signOAuthState('admin-1');
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
        id: 'token-1', userId: 'admin-1', accessToken: 'old-access', refreshToken: 'old-refresh', scope: 'old-scope',
      });
      (prisma.googleOAuthToken.upsert as any).mockResolvedValue({ id: 'token-1' });
      mockGetToken.mockResolvedValue({
        tokens: {
          access_token: 'new-access',
          expiry_date: Date.now() + 3600 * 1000,
          scope: 'https://www.googleapis.com/auth/calendar.events',
        },
      });

      const res = await request(app)
        .get('/api/v1/calendar/google/callback')
        .query({ code: 'auth-code', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=connected');
      const upsertCall = (prisma.googleOAuthToken.upsert as any).mock.calls[0][0];
      expect(upsertCall.update.accessToken.startsWith(ENCRYPTED_TOKEN_PREFIX)).toBe(true);
      expect(upsertCall.update.accessToken).not.toBe('new-access');
      expect(decryptSecret(upsertCall.update.accessToken)).toBe('new-access');
      expect(upsertCall.update.refreshToken).toBeUndefined();
    });

    it('redireciona com erro quando a troca do code pelos tokens falha', async () => {
      configureGoogleEnv();
      const state = signOAuthState('admin-1');
      mockGetToken.mockRejectedValue(new Error('invalid_grant'));

      const res = await request(app)
        .get('/api/v1/calendar/google/callback')
        .query({ code: 'bad-code', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/configuracoes?google=error');
      expect(prisma.googleOAuthToken.upsert).not.toHaveBeenCalled();
    });
  });

  describe('GET /calendar/google/status', () => {
    it('exige autenticação (401 sem token)', async () => {
      const res = await request(app).get('/api/v1/calendar/google/status');
      expect(res.status).toBe(401);
    });

    it('retorna connected:true quando existe um GoogleOAuthToken para o usuário', async () => {
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({ id: 'token-1' });

      const res = await request(app)
        .get('/api/v1/calendar/google/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: true });
      expect(prisma.googleOAuthToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'admin-1' },
      }));
    });

    it('retorna connected:false quando não existe conexão', async () => {
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/calendar/google/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
    });
  });

  describe('DELETE /calendar/google/status', () => {
    it('exige autenticação (401 sem token)', async () => {
      const res = await request(app).delete('/api/v1/calendar/google/status');
      expect(res.status).toBe(401);
    });

    it('remove o token local e tenta revogar junto ao Google quando configurado', async () => {
      configureGoogleEnv();
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
        id: 'token-1', userId: 'admin-1', accessToken: 'access-1',
      });
      (prisma.googleOAuthToken.delete as any).mockResolvedValue({ id: 'token-1' });
      mockRevokeToken.mockResolvedValue({});

      const res = await request(app)
        .delete('/api/v1/calendar/google/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
      expect(mockRevokeToken).toHaveBeenCalledWith('access-1');
      expect(prisma.googleOAuthToken.delete).toHaveBeenCalledWith({ where: { userId: 'admin-1' } });
    });

    it('remove o token local mesmo que a revogação no Google falhe (não bloqueante)', async () => {
      configureGoogleEnv();
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue({
        id: 'token-1', userId: 'admin-1', accessToken: 'access-1',
      });
      (prisma.googleOAuthToken.delete as any).mockResolvedValue({ id: 'token-1' });
      mockRevokeToken.mockRejectedValue(new Error('invalid_token'));

      const res = await request(app)
        .delete('/api/v1/calendar/google/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
      expect(prisma.googleOAuthToken.delete).toHaveBeenCalledWith({ where: { userId: 'admin-1' } });
    });

    it('não chama a API do Google e não falha quando não há conexão para remover', async () => {
      (prisma.googleOAuthToken.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/v1/calendar/google/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false });
      expect(mockRevokeToken).not.toHaveBeenCalled();
      expect(prisma.googleOAuthToken.delete).not.toHaveBeenCalled();
    });
  });
});
