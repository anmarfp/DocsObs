import dotenv from 'dotenv';
dotenv.config();

import crypto from 'node:crypto';
import { z } from 'zod';

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user?: string;
  readonly pass?: string;
  readonly secure: boolean;
  readonly from: string;
}

export interface Env {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly JWT_SECRET: string;
  readonly JWT_EXPIRES_IN: string;
  readonly DATABASE_URL?: string;
  readonly PORT: number;
  readonly FRONTEND_URL: string;
  readonly UPLOAD_DIR: string;
  readonly MAX_FILE_SIZE_BYTES: number;
  readonly APP_TIMEZONE?: string;
  readonly CRON_ENABLED: boolean;
  readonly EXTRACTION_SERVICE_URL?: string;
  readonly EXTRACTION_TIMEOUT_MS: number;
  readonly google: GoogleConfig | null;
  readonly smtp: SmtpConfig | null;
}

let processHasWarnedSecret = false;

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'], {
        errorMap: () => ({ message: 'NODE_ENV deve ser "development", "test" ou "production"' }),
      })
      .default('development'),
    PORT: z.preprocess((val) => {
      if (val === undefined || val === '') return 3001;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'PORT deve ser um número válido' }).int('PORT deve ser um número inteiro').positive('PORT deve ser maior que zero').max(65535, 'PORT deve ser uma porta válida')),
    FRONTEND_URL: z.preprocess((val) => {
      if (val === undefined || val === '') return 'http://localhost:5173';
      return val;
    }, z.string()),
    UPLOAD_DIR: z.preprocess((val) => {
      if (val === undefined || val === '') return './uploads';
      return val;
    }, z.string()),
    MAX_FILE_SIZE_BYTES: z.preprocess((val) => {
      if (val === undefined || val === '') return 10 * 1024 * 1024;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'MAX_FILE_SIZE_BYTES deve ser um número válido' }).int('MAX_FILE_SIZE_BYTES deve ser um número inteiro').positive('MAX_FILE_SIZE_BYTES deve ser maior que zero')),
    APP_TIMEZONE: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    JWT_EXPIRES_IN: z.preprocess((val) => {
      if (val === undefined || val === '') return '7d';
      return val;
    }, z.string()),
    JWT_SECRET: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    DATABASE_URL: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    GOOGLE_CLIENT_ID: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    GOOGLE_REDIRECT_URI: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    CRON_ENABLED: z.preprocess((val) => {
      if (val === undefined || val === '') return true;
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return val;
    }, z.boolean({ invalid_type_error: 'CRON_ENABLED deve ser um booleano' })),
    SMTP_HOST: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    SMTP_PORT: z.preprocess((val) => {
      if (val === undefined || val === '') return 587;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'SMTP_PORT deve ser um número válido' }).int('SMTP_PORT deve ser um número inteiro').positive('SMTP_PORT deve ser maior que zero').max(65535, 'SMTP_PORT deve ser uma porta válida')),
    SMTP_USER: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    SMTP_PASS: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    SMTP_SECURE: z.preprocess((val) => {
      if (val === undefined || val === '') return false;
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return val;
    }, z.boolean({ invalid_type_error: 'SMTP_SECURE deve ser um booleano' })),
    EMAIL_FROM: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().optional()),
    EXTRACTION_SERVICE_URL: z.preprocess((val) => {
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    }, z.string().url('EXTRACTION_SERVICE_URL deve ser uma URL válida').optional()),
    EXTRACTION_TIMEOUT_MS: z.preprocess((val) => {
      if (val === undefined || val === '') return 60000;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'EXTRACTION_TIMEOUT_MS deve ser um número válido' }).int('EXTRACTION_TIMEOUT_MS deve ser um número inteiro').positive('EXTRACTION_TIMEOUT_MS deve ser maior que zero')),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL é obrigatória quando NODE_ENV=production.',
        });
      }
      if (!data.JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET é obrigatório quando NODE_ENV=production.',
        });
      } else if (data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET deve ter no mínimo 32 caracteres quando NODE_ENV=production.',
        });
      }
    }

    const googleMap: Record<string, string | undefined> = {
      GOOGLE_CLIENT_ID: data.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: data.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: data.GOOGLE_REDIRECT_URI,
    };
    const setGoogle = Object.keys(googleMap).filter((k) => Boolean(googleMap[k]));
    const unsetGoogle = Object.keys(googleMap).filter((k) => !googleMap[k]);

    if (setGoogle.length > 0 && unsetGoogle.length > 0) {
      for (const missing of unsetGoogle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [missing],
          message: `${missing} é obrigatório quando a integração Google está parcialmente configurada.`,
        });
      }
    }

    if (data.SMTP_HOST) {
      if (!data.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM é obrigatório quando SMTP_HOST está configurado.',
        });
      }
      const hasUser = Boolean(data.SMTP_USER);
      const hasPass = Boolean(data.SMTP_PASS);
      if (hasUser !== hasPass) {
        const missing = hasUser ? 'SMTP_PASS' : 'SMTP_USER';
        const present = hasUser ? 'SMTP_USER' : 'SMTP_PASS';
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [missing],
          message: `${missing} é obrigatório quando ${present} está configurado.`,
        });
      }
    } else {
      if (data.SMTP_USER || data.SMTP_PASS) {
        const present = data.SMTP_USER ? 'SMTP_USER' : 'SMTP_PASS';
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_HOST'],
          message: `SMTP_HOST é obrigatório quando ${present} está configurado.`,
        });
      }
    }
  });

export function loadEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const errorLines = parsed.error.issues.map((issue) => {
      const varName = issue.path.join('.') || 'ENV';
      return `  - ${varName}: ${issue.message}`;
    });
    throw new Error(
      `Falha na validação das variáveis de ambiente:\n${errorLines.join('\n')}`
    );
  }

  let jwtSecret = parsed.data.JWT_SECRET;
  if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(48).toString('base64url');
    if (!processHasWarnedSecret) {
      console.warn(
        '⚠️ [DocsObs] JWT_SECRET não configurado. Segredo temporário gerado; tokens não sobreviverão a um reinício do processo.'
      );
      processHasWarnedSecret = true;
    }
  }

  const google: GoogleConfig | null =
    parsed.data.GOOGLE_CLIENT_ID &&
    parsed.data.GOOGLE_CLIENT_SECRET &&
    parsed.data.GOOGLE_REDIRECT_URI
      ? Object.freeze({
          clientId: parsed.data.GOOGLE_CLIENT_ID,
          clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
          redirectUri: parsed.data.GOOGLE_REDIRECT_URI,
        })
      : null;

  const smtp: SmtpConfig | null = parsed.data.SMTP_HOST
    ? Object.freeze({
        host: parsed.data.SMTP_HOST,
        port: parsed.data.SMTP_PORT,
        user: parsed.data.SMTP_USER,
        pass: parsed.data.SMTP_PASS,
        secure: parsed.data.SMTP_SECURE,
        from: parsed.data.EMAIL_FROM!,
      })
    : null;

  return Object.freeze({
    NODE_ENV: parsed.data.NODE_ENV,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: parsed.data.JWT_EXPIRES_IN,
    DATABASE_URL: parsed.data.DATABASE_URL,
    PORT: parsed.data.PORT,
    FRONTEND_URL: parsed.data.FRONTEND_URL,
    UPLOAD_DIR: parsed.data.UPLOAD_DIR,
    MAX_FILE_SIZE_BYTES: parsed.data.MAX_FILE_SIZE_BYTES,
    APP_TIMEZONE: parsed.data.APP_TIMEZONE,
    CRON_ENABLED: parsed.data.CRON_ENABLED,
    EXTRACTION_SERVICE_URL: parsed.data.EXTRACTION_SERVICE_URL,
    EXTRACTION_TIMEOUT_MS: parsed.data.EXTRACTION_TIMEOUT_MS,
    google,
    smtp,
  });
}

export const env: Env = (() => {
  try {
    return loadEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
})();
