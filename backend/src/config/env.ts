import dotenv from 'dotenv';
dotenv.config();

import crypto from 'node:crypto';
import { z } from 'zod';

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
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
  readonly google: GoogleConfig | null;
}

let processFallbackSecret: string | null = null;
let processHasWarnedSecret = false;

function getProcessFallbackSecret(): string {
  if (!processFallbackSecret) {
    processFallbackSecret = crypto.randomBytes(48).toString('base64url');
  }
  if (!processHasWarnedSecret) {
    console.warn(
      '⚠️ [DocsObs] JWT_SECRET não configurado. Segredo temporário gerado; tokens não sobreviverão a um reinício do processo.'
    );
    processHasWarnedSecret = true;
  }
  return processFallbackSecret;
}

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
    if (source === process.env) {
      jwtSecret = getProcessFallbackSecret();
    } else {
      jwtSecret = crypto.randomBytes(48).toString('base64url');
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
    google,
  });
}

const initialEnv = loadEnv(process.env);

export const env: Env = Object.freeze(
  Object.defineProperties({} as Env, {
    NODE_ENV: {
      get() {
        return (process.env.NODE_ENV as Env['NODE_ENV']) || initialEnv.NODE_ENV;
      },
      enumerable: true,
    },
    JWT_SECRET: {
      get() {
        return process.env.JWT_SECRET || initialEnv.JWT_SECRET;
      },
      enumerable: true,
    },
    JWT_EXPIRES_IN: {
      get() {
        return process.env.JWT_EXPIRES_IN || initialEnv.JWT_EXPIRES_IN;
      },
      enumerable: true,
    },
    DATABASE_URL: {
      get() {
        return process.env.DATABASE_URL || initialEnv.DATABASE_URL;
      },
      enumerable: true,
    },
    PORT: {
      get() {
        if (process.env.PORT) {
          const num = Number(process.env.PORT);
          return Number.isNaN(num) ? initialEnv.PORT : num;
        }
        return initialEnv.PORT;
      },
      enumerable: true,
    },
    FRONTEND_URL: {
      get() {
        return process.env.FRONTEND_URL || initialEnv.FRONTEND_URL;
      },
      enumerable: true,
    },
    UPLOAD_DIR: {
      get() {
        return process.env.UPLOAD_DIR || initialEnv.UPLOAD_DIR;
      },
      enumerable: true,
    },
    MAX_FILE_SIZE_BYTES: {
      get() {
        if (process.env.MAX_FILE_SIZE_BYTES) {
          const num = Number(process.env.MAX_FILE_SIZE_BYTES);
          return Number.isNaN(num) ? initialEnv.MAX_FILE_SIZE_BYTES : num;
        }
        return initialEnv.MAX_FILE_SIZE_BYTES;
      },
      enumerable: true,
    },
    APP_TIMEZONE: {
      get() {
        return process.env.APP_TIMEZONE !== undefined
          ? process.env.APP_TIMEZONE
          : initialEnv.APP_TIMEZONE;
      },
      enumerable: true,
    },
    google: {
      get() {
        const id = process.env.GOOGLE_CLIENT_ID?.trim();
        const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
        const uri = process.env.GOOGLE_REDIRECT_URI?.trim();
        if (id && secret && uri) {
          return { clientId: id, clientSecret: secret, redirectUri: uri };
        }
        return null;
      },
      enumerable: true,
    },
  })
);
