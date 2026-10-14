import { Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { signOAuthState, verifyOAuthState } from '../utils/jwt.js';
import { env } from '../config/env.js';

/**
 * Fluxo de conexão OAuth por usuário com o Google Agenda (ADR-009 / DOC-28, subtarefa 2).
 * Este módulo cuida apenas de conectar/desconectar a conta e persistir os tokens em
 * `GoogleOAuthToken`. A sincronização real com a API do Google Calendar é a subtarefa 3
 * (`gcalService.ts`), que ainda não consome estes tokens.
 */

// Escopo mínimo necessário para ler e escrever eventos no Google Agenda do usuário (RF-005).
const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function getFrontendUrl(): string {
  return env.FRONTEND_URL.replace(/\/+$/, '');
}

function isGoogleOAuthConfigured(): boolean {
  return env.google !== null;
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.google?.clientId,
    env.google?.clientSecret,
    env.google?.redirectUri
  );
}

/**
 * GET /calendar/google/connect (autenticado, ADMIN e OPERATIONAL)
 * Gera a URL de consentimento do Google e a devolve em JSON para que o frontend
 * redirecione o navegador (`window.location.href = url`). Não redireciona a partir
 * do próprio backend porque este endpoint exige o header `Authorization: Bearer`
 * (via `authMiddleware`) e uma navegação de página inteira feita pelo navegador não
 * consegue anexar esse header — por isso o cliente busca a URL via XHR autenticado
 * e só então navega, sem header algum, para a própria tela de consentimento do Google.
 */
export async function getGoogleAuthUrl(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({
        error: 'GOOGLE_OAUTH_NOT_CONFIGURED',
        message:
          'A integração com o Google Agenda não está configurada neste ambiente (defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI).',
      });
      return;
    }

    // `state` carrega o userId autenticado assinado com o mesmo segredo JWT da
    // aplicação, para que o callback (que não recebe Bearer token, pois é o
    // navegador sendo redirecionado pelo Google) possa confiar nele.
    // Deliberadamente NÃO reaproveita `generateToken` (o token de login): um
    // `state` de OAuth trafega em canais baseados em URL (query string, logs de
    // acesso do próprio Google e do servidor, histórico do navegador) muito mais
    // expostos que um header `Authorization`, então usa `signOAuthState`, que
    // assina só o `userId` com validade de minutos, não dias.
    const state = signOAuthState(req.user!.userId);

    const oauth2Client = createOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_CALENDAR_SCOPES,
      state,
    });

    res.status(200).json({ url });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /calendar/google/callback (público — o navegador do usuário é redirecionado
 * aqui pelo Google, sem possibilidade de enviar um header Authorization).
 * Verifica o `state` assinado, troca o `code` pelos tokens e faz upsert em
 * `GoogleOAuthToken`. Sempre redireciona de volta para a tela de Configurações do
 * frontend com `?google=connected` ou `?google=error`.
 */
export async function handleGoogleAuthCallback(req: Request, res: Response): Promise<void> {
  const redirectTo = (status: 'connected' | 'error') =>
    res.redirect(`${getFrontendUrl()}/configuracoes?google=${status}`);

  try {
    const { code, state } = req.query;

    if (typeof code !== 'string' || typeof state !== 'string') {
      redirectTo('error');
      return;
    }

    let userId: string;
    try {
      userId = verifyOAuthState(state);
    } catch {
      redirectTo('error');
      return;
    }

    if (!isGoogleOAuthConfigured()) {
      redirectTo('error');
      return;
    }

    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    const existing = await prisma.googleOAuthToken.findUnique({ where: { userId } });

    // Com access_type=offline + prompt=consent o Google sempre devolve um
    // refresh_token na primeira conexão. Se não vier e ainda não houver um token
    // salvo para reaproveitar, não há como manter a conexão — trata como erro.
    if (!tokens.refresh_token && !existing) {
      redirectTo('error');
      return;
    }

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000);
    const scope = tokens.scope || GOOGLE_CALENDAR_SCOPES.join(' ');

    await prisma.googleOAuthToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token as string,
        expiryDate,
        scope,
      },
      update: {
        accessToken: tokens.access_token || existing?.accessToken || '',
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiryDate,
        scope,
      },
    });

    redirectTo('connected');
  } catch (error) {
    console.error('Erro no callback OAuth do Google Agenda:', error);
    redirectTo('error');
  }
}

/**
 * GET /calendar/google/status (autenticado)
 * Indica apenas se o usuário autenticado tem uma conexão ativa — nunca vaza os
 * valores de token.
 */
export async function getGoogleConnectionStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = await prisma.googleOAuthToken.findUnique({
      where: { userId: req.user!.userId },
      select: { id: true },
    });

    res.status(200).json({ connected: Boolean(token) });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /calendar/google/status (autenticado)
 * Remove a conexão local. Tenta revogar o token junto ao Google em melhor esforço:
 * se a revogação falhar (token já expirado/inválido, indisponibilidade do Google,
 * etc.), a remoção local prossegue de qualquer forma.
 */
export async function disconnectGoogleAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const existing = await prisma.googleOAuthToken.findUnique({
      where: { userId: req.user!.userId },
    });

    if (existing) {
      if (isGoogleOAuthConfigured()) {
        try {
          const oauth2Client = createOAuth2Client();
          await oauth2Client.revokeToken(existing.accessToken);
        } catch (revokeError) {
          console.error('Falha ao revogar token do Google (removendo localmente mesmo assim):', revokeError);
        }
      }

      await prisma.googleOAuthToken.delete({ where: { userId: req.user!.userId } });
    }

    res.status(200).json({ connected: false });
  } catch (error) {
    next(error);
  }
}
