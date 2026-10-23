import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('DOC-33 / DOC-44 - Validação de Variáveis de Ambiente (src/config/env.ts)', () => {
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

    it('valida com sucesso quando NODE_ENV=production, JWT_SECRET tem 32+ caracteres, DATABASE_URL está definida e Google não está configurado (sem GOOGLE_TOKEN_ENCRYPTION_KEY)', () => {
      const secret32 = 'a'.repeat(32);
      const loaded = loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
        JWT_SECRET: secret32,
      });

      expect(loaded.NODE_ENV).toBe('production');
      expect(loaded.JWT_SECRET).toBe(secret32);
      expect(loaded.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/docsobs');
      expect(loaded.google).toBeNull();
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

    it('DOC-44: lança erro quando NODE_ENV=production, Google está configurado e GOOGLE_TOKEN_ENCRYPTION_KEY está ausente', () => {
      expect(() =>
        loadEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
          JWT_SECRET: 'a'.repeat(32),
          GOOGLE_CLIENT_ID: 'prod-client-id',
          GOOGLE_CLIENT_SECRET: 'prod-client-secret',
          GOOGLE_REDIRECT_URI: 'https://docsobs.example.com/api/v1/calendar/google/callback',
        })
      ).toThrowError(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
    });

    it('DOC-44: aceita GOOGLE_TOKEN_ENCRYPTION_KEY com 32 bytes em base64 e base64url em produção com Google configurado', () => {
      const keyBase64 = crypto.randomBytes(32).toString('base64');
      const keyBase64Url = crypto.randomBytes(32).toString('base64url');

      const loadedB64 = loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
        JWT_SECRET: 'a'.repeat(32),
        GOOGLE_CLIENT_ID: 'prod-client-id',
        GOOGLE_CLIENT_SECRET: 'prod-client-secret',
        GOOGLE_REDIRECT_URI: 'https://docsobs.example.com/api/v1/calendar/google/callback',
        GOOGLE_TOKEN_ENCRYPTION_KEY: keyBase64,
      });
      expect(loadedB64.GOOGLE_TOKEN_ENCRYPTION_KEY).toBe(keyBase64);

      const loadedB64Url = loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
        JWT_SECRET: 'a'.repeat(32),
        GOOGLE_CLIENT_ID: 'prod-client-id',
        GOOGLE_CLIENT_SECRET: 'prod-client-secret',
        GOOGLE_REDIRECT_URI: 'https://docsobs.example.com/api/v1/calendar/google/callback',
        GOOGLE_TOKEN_ENCRYPTION_KEY: keyBase64Url,
      });
      expect(loadedB64Url.GOOGLE_TOKEN_ENCRYPTION_KEY).toBe(keyBase64Url);
    });

    it('DOC-44: lança erro quando GOOGLE_TOKEN_ENCRYPTION_KEY decodifica para 31 bytes (sem vazar a chave)', () => {
      const key31 = crypto.randomBytes(31).toString('base64');
      let errorMessage = '';
      try {
        loadEnv({
          NODE_ENV: 'development',
          GOOGLE_TOKEN_ENCRYPTION_KEY: key31,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toContain('GOOGLE_TOKEN_ENCRYPTION_KEY');
      expect(errorMessage).not.toContain(key31);
    });

    it('DOC-44: gera chave efêmera aleatória de 32 bytes quando GOOGLE_TOKEN_ENCRYPTION_KEY está ausente em development/test', () => {
      const env1 = loadEnv({ NODE_ENV: 'development' });
      const env2 = loadEnv({ NODE_ENV: 'test' });

      expect(Buffer.from(env1.GOOGLE_TOKEN_ENCRYPTION_KEY, 'base64').length).toBe(32);
      expect(Buffer.from(env2.GOOGLE_TOKEN_ENCRYPTION_KEY, 'base64').length).toBe(32);
      expect(env1.GOOGLE_TOKEN_ENCRYPTION_KEY).not.toBe(env2.GOOGLE_TOKEN_ENCRYPTION_KEY);
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

    it('define CRON_ENABLED como true por padrão quando omitido ou vazio', () => {
      const envDefault = loadEnv({});
      expect(envDefault.CRON_ENABLED).toBe(true);

      const envEmpty = loadEnv({ CRON_ENABLED: '' });
      expect(envEmpty.CRON_ENABLED).toBe(true);
    });

    it('define CRON_ENABLED como false quando "false"', () => {
      const envDisabled = loadEnv({ CRON_ENABLED: 'false' });
      expect(envDisabled.CRON_ENABLED).toBe(false);
    });

    it('define env.smtp como null quando SMTP_HOST não está definido ou está vazio', () => {
      const envNone = loadEnv({});
      expect(envNone.smtp).toBeNull();

      const envEmpty = loadEnv({ SMTP_HOST: '   ' });
      expect(envEmpty.smtp).toBeNull();
    });

    it('lança erro quando SMTP_HOST está configurado mas EMAIL_FROM está ausente', () => {
      expect(() =>
        loadEnv({
          SMTP_HOST: 'smtp.example.com',
        })
      ).toThrowError(/EMAIL_FROM/);
    });

    it('lança erro quando SMTP_USER está configurado mas SMTP_PASS está ausente', () => {
      expect(() =>
        loadEnv({
          SMTP_HOST: 'smtp.example.com',
          EMAIL_FROM: 'alertas@docsobs.com',
          SMTP_USER: 'user-docsobs',
        })
      ).toThrowError(/SMTP_PASS/);
    });

    it('lança erro quando SMTP_PASS está configurado mas SMTP_USER está ausente', () => {
      expect(() =>
        loadEnv({
          SMTP_HOST: 'smtp.example.com',
          EMAIL_FROM: 'alertas@docsobs.com',
          SMTP_PASS: 'secret-pass',
        })
      ).toThrowError(/SMTP_USER/);
    });

    it('não expõe o valor de SMTP_PASS no erro quando SMTP_USER está ausente', () => {
      const secretPass = 'super-secret-smtp-password-123';
      let errorMessage = '';
      try {
        loadEnv({
          SMTP_HOST: 'smtp.example.com',
          EMAIL_FROM: 'alertas@docsobs.com',
          SMTP_PASS: secretPass,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toContain('SMTP_USER');
      expect(errorMessage).not.toContain(secretPass);
    });

    it('popula env.smtp com portas e flags padrão (587, secure=false) quando configurado sem credenciais', () => {
      const loaded = loadEnv({
        SMTP_HOST: 'smtp.example.com',
        EMAIL_FROM: 'alertas@docsobs.com',
      });

      expect(loaded.smtp).toEqual({
        host: 'smtp.example.com',
        port: 587,
        user: undefined,
        pass: undefined,
        secure: false,
        from: 'alertas@docsobs.com',
      });
    });

    it('popula env.smtp completamente com porta 465, secure=true e credenciais de autenticação', () => {
      const loaded = loadEnv({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'usuario',
        SMTP_PASS: 'senha-secreta',
        EMAIL_FROM: 'DocsObs <alertas@docsobs.com>',
      });

      expect(loaded.smtp).toEqual({
        host: 'smtp.example.com',
        port: 465,
        user: 'usuario',
        pass: 'senha-secreta',
        secure: true,
        from: 'DocsObs <alertas@docsobs.com>',
      });
    });
  });

  describe('Boot test', () => {
    it('aborta no boot com código 1 e nomeia JWT_SECRET no stderr sem stack trace quando NODE_ENV=production sem JWT_SECRET', () => {
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

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('JWT_SECRET');
      expect(result.stderr).not.toContain('    at ');
    });

    it('DOC-44: aborta no boot com código 1 quando NODE_ENV=production, Google está configurado e GOOGLE_TOKEN_ENCRYPTION_KEY está ausente', () => {
      const backendDir = path.resolve(__dirname, '..');
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '-e', 'import("./src/config/env.ts")'],
        {
          cwd: backendDir,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/docsobs',
            GOOGLE_CLIENT_ID: 'prod-id',
            GOOGLE_CLIENT_SECRET: 'prod-secret',
            GOOGLE_REDIRECT_URI: 'https://docsobs.example.com/callback',
            GOOGLE_TOKEN_ENCRYPTION_KEY: '',
          },
          encoding: 'utf8',
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GOOGLE_TOKEN_ENCRYPTION_KEY');
      expect(result.stderr).not.toContain('    at ');
    });
  });
});
