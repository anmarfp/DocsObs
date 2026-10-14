import jwt, { SignOptions } from 'jsonwebtoken';
import { TokenPayload } from '../types/index.js';
import { env } from '../config/env.js';

export function generateToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

const OAUTH_STATE_PURPOSE = 'google-oauth-state';

/**
 * Assina um `state` de uso único para o fluxo OAuth do Google Agenda (DOC-28).
 * Deliberadamente distinto de `generateToken`: carrega só o `userId` (sem
 * email/role/name) e expira em minutos, não dias, para que um `state` exposto
 * em um canal baseado em URL (query string, logs de acesso do Google ou do
 * próprio servidor, histórico do navegador) tenha valor residual mínimo — ao
 * contrário de um token de login completo, que ficaria válido por dias.
 */
export function signOAuthState(userId: string): string {
  return jwt.sign({ userId, purpose: OAUTH_STATE_PURPOSE }, env.JWT_SECRET, { expiresIn: '10m' });
}

export function verifyOAuthState(token: string): string {
  const decoded = jwt.verify(token, env.JWT_SECRET) as { userId?: string; purpose?: string };
  if (decoded.purpose !== OAUTH_STATE_PURPOSE || !decoded.userId) {
    throw new Error('Token de estado OAuth inválido.');
  }
  return decoded.userId;
}
