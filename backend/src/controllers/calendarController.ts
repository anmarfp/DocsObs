import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { syncAllDocuments } from '../services/gcalService.js';

const getCalendarEventsQuerySchema = z.object({
  month: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .refine((val) => val === undefined || (!isNaN(val) && val >= 1 && val <= 12), {
      message: 'month deve estar entre 1 e 12.',
    }),
  year: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .refine((val) => val === undefined || (!isNaN(val) && val >= 1970 && val <= 2100), {
      message: 'year deve ser um ano válido.',
    }),
});

const getSyncLogsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 20)) : 20)),
});

/**
 * Retorna os eventos de vencimento para o calendário com suporte a filtros de mês e ano (RF-005).
 */
export async function getCalendarEvents(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = getCalendarEventsQuerySchema.parse(req.query);

    const where: Prisma.DocumentWhereInput = {
      isArchived: false,
      expirationDate: { not: null },
    };

    // expirationDate é data civil em meia-noite UTC (DOC-27): os limites do período
    // também são calculados em UTC para não deslocar o dia conforme o fuso do processo.
    if (query.year !== undefined && query.month !== undefined) {
      const startOfMonth = new Date(Date.UTC(query.year, query.month - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
      where.expirationDate = {
        gte: startOfMonth,
        lte: endOfMonth,
      };
    } else if (query.year !== undefined) {
      const startOfYear = new Date(Date.UTC(query.year, 0, 1, 0, 0, 0, 0));
      const endOfYear = new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999));
      where.expirationDate = {
        gte: startOfYear,
        lte: endOfYear,
      };
    }

    const documents = await prisma.document.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: {
        expirationDate: 'asc',
      },
    });

    const events = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      expirationDate: doc.expirationDate instanceof Date ? doc.expirationDate.toISOString() : (doc.expirationDate || null),
      status: doc.status,
      category: doc.category
        ? {
            id: doc.category.id,
            name: doc.category.name,
            colorHex: doc.category.colorHex,
            description: doc.category.description,
          }
        : null,
      colorHex: doc.category?.colorHex || '#3b82f6',
    }));

    res.status(200).json({ events });
  } catch (error) {
    next(error);
  }
}

/**
 * Dispara a sincronização manual de todos os documentos ativos com o Google Agenda (RF-005).
 */
export async function syncCalendar(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await syncAllDocuments();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna os logs de sincronização do Google Agenda (Auditabilidade de integração - Restrito a Administradores).
 */
export async function getSyncLogs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = getSyncLogsQuerySchema.parse(req.query);

    const total = await prisma.gCalSyncLog.count();
    const skip = (query.page - 1) * query.limit;

    const logs = await prisma.gCalSyncLog.findMany({
      skip,
      take: query.limit,
      orderBy: { lastSyncedAt: 'desc' },
      include: {
        document: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.status(200).json({
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
      logs,
    });
  } catch (error) {
    next(error);
  }
}
