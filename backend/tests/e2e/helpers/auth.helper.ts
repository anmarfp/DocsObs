import supertest from 'supertest';
import { fileURLToPath } from 'node:url';

const rawBaseUrl = process.env.E2E_BASE_URL;

if (!rawBaseUrl) {
  throw new Error(
    'E2E_BASE_URL e obrigatoria. Execute `npm run test:e2e` para usar a stack Docker isolada.'
  );
}

const baseUrl = new URL(rawBaseUrl);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const normalizedPath = baseUrl.pathname.replace(/\/$/, '');

if (
  baseUrl.protocol !== 'http:' ||
  !loopbackHosts.has(baseUrl.hostname) ||
  normalizedPath !== '/api/v1'
) {
  throw new Error(
    `E2E_BASE_URL recusada: ${rawBaseUrl}. Use uma URL HTTP loopback terminada em /api/v1.`
  );
}

export const getRequest = () => supertest(baseUrl.origin);
export const minimalPdfPath = fileURLToPath(new URL('../fixtures/minimal.pdf', import.meta.url));

export const getApiPath = (targetPath: string): string => {
  if (!targetPath.startsWith('/api/v1/')) {
    throw new Error(`Caminho E2E fora da API v1: ${targetPath}`);
  }
  return targetPath;
};

export const uniqueValue = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const isoDateFromNow = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export interface AuthTokens {
  adminToken: string;
  operationalToken: string;
}

let authTokensPromise: Promise<AuthTokens> | undefined;

// As senhas do seed nao sao versionadas (DOC-32): a suite usa as mesmas
// variaveis repassadas ao backend pelo docker compose.
function requireSeedPassword(name: 'ADMIN_SEED_PASSWORD' | 'OPERATIONAL_SEED_PASSWORD'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} e obrigatoria para a suite E2E (mesmo valor usado no seed do backend).`);
  }
  return value;
}

export async function getAuthTokens(): Promise<AuthTokens> {
  authTokensPromise ??= (async () => {
    const req = getRequest();
    const adminRes = await req
      .post(getApiPath('/api/v1/auth/login'))
      .send({ email: 'admin@docsobs.com.br', password: requireSeedPassword('ADMIN_SEED_PASSWORD') });

    if (adminRes.status !== 200 || !adminRes.body?.token) {
      throw new Error(`Falha no login Admin do seed: ${adminRes.status} ${JSON.stringify(adminRes.body)}`);
    }

    const operationalRes = await req
      .post(getApiPath('/api/v1/auth/login'))
      .send({ email: 'operacional@docsobs.com.br', password: requireSeedPassword('OPERATIONAL_SEED_PASSWORD') });

    if (operationalRes.status !== 200 || !operationalRes.body?.token) {
      throw new Error(
        `Falha no login Operacional do seed: ${operationalRes.status} ${JSON.stringify(operationalRes.body)}`
      );
    }

    return {
      adminToken: adminRes.body.token,
      operationalToken: operationalRes.body.token,
    };
  })();

  return authTokensPromise;
}

export async function getCategoryId(token: string): Promise<string> {
  const response = await getRequest()
    .get(getApiPath('/api/v1/categories'))
    .set('Authorization', `Bearer ${token}`);

  if (response.status !== 200 || !response.body.categories?.[0]?.id) {
    throw new Error(`Nenhuma categoria do seed disponivel: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return response.body.categories[0].id;
}
