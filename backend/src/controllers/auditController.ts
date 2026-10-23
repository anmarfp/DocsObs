import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { addCivilDays, getStartOfCivilDayInTimeZone, parseCivilDate } from '../utils/date.js';

const listAuditLogsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 20)) : 20)),
  documentId: z.string().optional(),
  userId: z.string().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  startDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'startDate inválida.' }),
  endDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'endDate inválida.' }),
  search: z.string().optional(),
});

/**
 * Lista o histórico global de auditoria com paginação e filtros (RF-013 - Restrito a Administradores).
 */
export async function listAuditLogs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = listAuditLogsQuerySchema.parse(req.query);

    const where: Prisma.AuditLogWhereInput = {};

    if (query.documentId) {
      where.documentId = query.documentId;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.startDate || query.endDate) {
      where.timestamp = {
        ...(query.startDate && { gte: getStartOfCivilDayInTimeZone(query.startDate) }),
        ...(query.endDate && {
          lt: getStartOfCivilDayInTimeZone(addCivilDays(parseCivilDate(query.endDate), 1)),
        }),
      };
    }

    if (query.search && query.search.trim() !== '') {
      where.userName = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const total = await prisma.auditLog.count({ where });
    const skip = (query.page - 1) * query.limit;

    const logs = await prisma.auditLog.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { timestamp: 'desc' },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            isArchived: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
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

/**
 * Retorna os detalhes de um registro específico de auditoria por ID (RF-013).
 */
export async function getAuditLogById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            isArchived: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!log) {
      res.status(404).json({
        error: 'AUDIT_LOG_NOT_FOUND',
        message: 'Registro de auditoria não encontrado.',
      });
      return;
    }

    res.status(200).json({ log });
  } catch (error) {
    next(error);
  }
}
