#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectName = `docsobs-e2e-${process.pid}`.toLowerCase();
const npmCli = process.env.npm_execpath;

function validateBaseUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (
    parsed.protocol !== 'http:' ||
    !loopbackHosts.has(parsed.hostname) ||
    parsed.pathname.replace(/\/$/, '') !== '/api/v1'
  ) {
    throw new Error(
      `E2E_BASE_URL recusada: ${rawUrl}. Use uma URL HTTP loopback terminada em /api/v1.`
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

function run(command, args, env, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    stdio: 'inherit',
    ...options,
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runOrThrow(command, args, env, label) {
  const status = run(command, args, env);
  if (status !== 0) throw new Error(`${label} falhou com codigo ${status}.`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function runVitest(baseUrl, env) {
  if (!npmCli) {
    throw new Error('npm_execpath ausente. Execute o runner por `npm run test:e2e`.');
  }
  runOrThrow(
    process.execPath,
    [npmCli, '--prefix', 'backend', 'run', 'test:e2e'],
    { ...env, E2E_BASE_URL: validateBaseUrl(baseUrl) },
    'Suite HTTP E2E'
  );
}

async function main() {
  console.log('[E2E] Iniciando integracao HTTP contra stack real.');

  if (process.env.E2E_BASE_URL) {
    console.log('[E2E] Usando stack loopback fornecida por E2E_BASE_URL.');
    await runVitest(process.env.E2E_BASE_URL, process.env);
    return;
  }

  runOrThrow('docker', ['info'], process.env, 'Docker daemon');

  const [postgresPort, backendPort, frontendPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ]);
  const composeEnv = {
    ...process.env,
    POSTGRES_USER: 'docsobs_e2e',
    POSTGRES_PASSWORD: 'docsobs_e2e_password',
    POSTGRES_DB: 'docsobs_e2e',
    POSTGRES_PORT: String(postgresPort),
    BACKEND_PORT: String(backendPort),
    FRONTEND_PORT: String(frontendPort),
    PORT: '3001',
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
    RUN_SEED: 'true',
    ADMIN_SEED_PASSWORD:
      process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(18).toString('base64url'),
    OPERATIONAL_SEED_PASSWORD:
      process.env.OPERATIONAL_SEED_PASSWORD || crypto.randomBytes(18).toString('base64url'),
  };
  const compose = ['compose', '-p', projectName];
  let attemptedUp = false;

  try {
    attemptedUp = true;
    runOrThrow(
      'docker',
      [...compose, 'up', '-d', '--build', '--wait', '--wait-timeout', '120'],
      composeEnv,
      'Subida da stack E2E isolada'
    );
    runOrThrow('docker', [...compose, 'ps'], composeEnv, 'Inspecao da stack E2E');
    await runVitest(`http://127.0.0.1:${frontendPort}/api/v1`, composeEnv);
  } catch (error) {
    console.error(`[E2E] ${error instanceof Error ? error.message : String(error)}`);
    run('docker', [...compose, 'ps'], composeEnv);
    run('docker', [...compose, 'logs', '--no-color', '--tail', '200'], composeEnv);
    throw error;
  } finally {
    if (attemptedUp) {
      const cleanupStatus = run(
        'docker',
        [...compose, 'down', '-v', '--remove-orphans'],
        composeEnv
      );
      if (cleanupStatus !== 0) {
        console.error(`[E2E] Cleanup isolado falhou com codigo ${cleanupStatus}.`);
        process.exitCode = cleanupStatus;
      }
    }
  }
}

main()
  .then(() => {
    if (!process.exitCode) console.log('[E2E] Suite HTTP E2E concluida com sucesso.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
