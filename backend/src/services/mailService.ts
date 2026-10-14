import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env.js';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text: string;
}

export interface SendMailSuccess {
  dispatched: true;
  messageId: string;
}

export interface SendMailFailure {
  dispatched: false;
  error: string;
}

export type SendMailResult = SendMailSuccess | SendMailFailure;

let transporter: Transporter | null = null;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getMailTransporter(): Transporter | null {
  if (!env.smtp) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth:
        env.smtp.user && env.smtp.pass
          ? {
              user: env.smtp.user,
              pass: env.smtp.pass,
            }
          : undefined,
    });
  }
  return transporter;
}

export function resetMailTransporter(): void {
  transporter = null;
}

/**
 * Envia um e-mail através do transporte SMTP configurado (nodemailer).
 * Tenta novamente até 2 vezes extras em falhas transitórias com backoff curto.
 * Nunca lança exceção para o chamador.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof AggregateError && Array.isArray(err.errors) && err.errors.length > 0) {
    const subMessages = err.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .filter((msg) => Boolean(msg && msg.trim()));
    if (subMessages.length > 0) {
      return subMessages.join('; ');
    }
  }
  if (err instanceof Error && err.message && err.message.trim() !== '') {
    return err.message.trim();
  }
  if (typeof err === 'object' && err !== null) {
    if ('code' in err && typeof (err as any).code === 'string') {
      return (err as any).code;
    }
  }
  return String(err) || 'Erro no envio de e-mail';
}

export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  try {
    if (!env.smtp) {
      console.warn('⚠️ [DocsObs] SMTP não configurado. Disparo de e-mail cancelado.');
      return { dispatched: false, error: 'SMTP não configurado' };
    }

    const tx = getMailTransporter();
    if (!tx) {
      console.warn('⚠️ [DocsObs] SMTP não configurado. Disparo de e-mail cancelado.');
      return { dispatched: false, error: 'SMTP não configurado' };
    }

    const mailOptions = {
      from: env.smtp.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const info = await tx.sendMail(mailOptions);
        return {
          dispatched: true,
          messageId: info?.messageId || '',
        };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }

    const errorMessage = extractErrorMessage(lastError);
    return {
      dispatched: false,
      error: errorMessage,
    };
  } catch (fatalError) {
    const errorMessage = extractErrorMessage(fatalError);
    return {
      dispatched: false,
      error: errorMessage,
    };
  }
}
