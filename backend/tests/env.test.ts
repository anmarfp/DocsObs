import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('DOC-33 - Validação de Variáveis de Ambiente (src/config/env.ts)', () => {
  describe('Tabela de Casos loadEnv', () => {
    it('lança erro quando NODE_ENV=production e JWT_SECRET não está definido', () => {
      expect(() =>
        loadEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
        })
      ).toThrowError(/JWT_SECRET/);
    });

    it('lança erro quando NODE_ENV=production e JWT_SECRET tem 31 caracteres', () => {
      const secret31 = 'a'.repeat(31);
      expect(() =>
        loadEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
          JWT_SECRET: secret31,
        })
      ).toThrowError(/JWT_SECRET/);
    });

    it('valida com sucesso quando NODE_ENV=production, JWT_SECRET tem 32+ caracteres e DATABASE_URL está definida', () => {
      const secret32 = 'a'.repeat(32);
      const loaded = loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
        JWT_SECRET: secret32,
      });

      expect(loaded.NODE_ENV).toBe('production');
      expect(loaded.JWT_SECRET).toBe(secret32);
      expect(loaded.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/docsobs');
    });

    it('lança erro quando NODE_ENV=production e DATABASE_URL não está definida', () => {
      expect(() =>
        loadEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'a'.repeat(32),
        })
      ).toThrowError(/DATABASE_URL/);
    });

    it('gera segredo aleatório com 32+ caracteres diferente entre duas chamadas quando NODE_ENV=development e JWT_SECRET ausente', () => {
      const env1 = loadEnv({ NODE_ENV: 'development' });
      const env2 = loadEnv({ NODE_ENV: 'development' });

      expect(env1.JWT_SECRET).toBeDefined();
      expect(env1.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(env2.JWT_SECRET).toBeDefined();
      expect(env2.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(env1.JWT_SECRET).not.toBe(env2.JWT_SECRET);
    });

    it('lança erro nomeando as variáveis ausentes quando apenas GOOGLE_CLIENT_ID está configurado', () => {
      let errorMessage = '';
      try {
        loadEnv({
          GOOGLE_CLIENT_ID: 'test-google-client-id',
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toContain('GOOGLE_CLIENT_SECRET');
      expect(errorMessage).toContain('GOOGLE_REDIRECT_URI');
    });

    it('popula env.google quando todas as 3 variáveis Google estão definidas', () => {
      const loaded = loadEnv({
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/v1/calendar/google/callback',
      });

      expect(loaded.google).toEqual({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3001/api/v1/calendar/google/callback',
      });
    });

    it('define env.google como null quando nenhuma variável Google está definida ou todas são vazias', () => {
      const envNone = loadEnv({});
      expect(envNone.google).toBeNull();

      const envEmpty = loadEnv({
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '   ',
        GOOGLE_REDIRECT_URI: '',
      });
      expect(envEmpty.google).toBeNull();
    });

    it('não expõe o valor do segredo na mensagem de erro quando o segredo é inválido', () => {
      const badSecret = 'super-secret-curto-12345';
      let errorMessage = '';
      try {
        loadEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
          JWT_SECRET: badSecret,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toContain('JWT_SECRET');
      expect(errorMessage).not.toContain(badSecret);
    });
  });

  describe('Boot test', () => {
    it('aborta no boot com código diferente de zero e nomeia JWT_SECRET no stderr quando NODE_ENV=production sem JWT_SECRET', () => {
      const backendDir = path.resolve(__dirname, '..');
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '-e', 'import("./src/config/env.ts")'],
        {
          cwd: backendDir,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            JWT_SECRET: '',
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
          },
          encoding: 'utf8',
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('JWT_SECRET');
    });
  });
});
