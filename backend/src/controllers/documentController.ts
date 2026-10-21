import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Role, DocumentStatus, AuditAction, NotificationMode, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { calculateDocumentStatus } from '../services/statusService.js';
import { deleteUploadedFile, detectFileType } from '../services/storageService.js';
import { syncDocumentEvent, deleteDocumentEvent } from '../services/gcalService.js';
import { env } from '../config/env.js';
import { extractFromBuffer } from '../services/extractionService.js';

function isPrismaP2002Error(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return typeof error === 'object' && error !== null && (error as any).code === 'P2002';
}

// Schema de validação para criação de documento
const createDocumentSchema = z.object({
  title: z
    .string({ required_error: 'O título do documento é obrigatório.' })
    .trim()
    .min(1, 'O título não pode estar em branco.')
    .max(200, 'O título pode ter no máximo 200 caracteres.'),
  categoryId: z
    .string({ required_error: 'A categoria do documento é obrigatória.' })
    .uuid('ID da categoria inválido.'),
  issuingBody: z
    .string()
    .trim()
    .max(150, 'O órgão emissor pode ter no máximo 150 caracteres.')
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
  issueDate: z
    .string({ required_error: 'A data de emissão é obrigatória.' })
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Data de emissão inválida.',
    }),
  expirationDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim()))
    .refine((val) => val === null || !isNaN(Date.parse(val)), {
      message: 'Data de vencimento inválida.',
    }),
  alertLeadDays: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return 30;
      const num = Number(val);
      return isNaN(num) ? 30 : num;
    })
    .pipe(z.number().int('Antecedência deve ser um número inteiro.').min(1, 'A antecedência mínima de alerta é de 1 dia.')),
  responsibleName: z
    .string()
    .trim()
    .max(150, 'Nome do responsável pode ter no máximo 150 caracteres.')
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
  responsibleEmail: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim()))
    .pipe(z.string().email('E-mail do responsável em formato inválido.').nullable().optional()),
  notes: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
  isRenewalInProgress: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => val === true || val === 'true'),
  extractionSuggestions: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
  extractionConfirmed: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
});

// Schema de validação para atualização de documento
const updateDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'O título não pode estar em branco.')
    .max(200, 'O título pode ter no máximo 200 caracteres.')
    .optional(),
  categoryId: z.string().uuid('ID da categoria inválido.').optional(),
  issuingBody: z
    .string()
    .trim()
    .max(150, 'O órgão emissor pode ter no máximo 150 caracteres.')
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : !val || val.trim() === '' ? null : val.trim())),
  issueDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'Data de emissão inválida.',
    }),
  expirationDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : !val || val.trim() === '' ? null : val.trim()))
    .refine((val) => val === undefined || val === null || !isNaN(Date.parse(val)), {
      message: 'Data de vencimento inválida.',
    }),
  alertLeadDays: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return 30;
      const num = Number(val);
      return isNaN(num) ? 30 : num;
    })
    .pipe(z.number().int('Antecedência deve ser um número inteiro.').min(1, 'A antecedência mínima de alerta é de 1 dia.').optional()),
  responsibleName: z
    .string()
    .trim()
    .max(150, 'Nome do responsável pode ter no máximo 150 caracteres.')
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : !val || val.trim() === '' ? null : val.trim())),
  responsibleEmail: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : !val || val.trim() === '' ? null : val.trim()))
    .pipe(z.string().email('E-mail do responsável em formato inválido.').nullable().optional()),
  notes: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : !val || val.trim() === '' ? null : val.trim())),
  status: z.nativeEnum(DocumentStatus).optional(),
  isRenewalInProgress: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === true || val === 'true')),
});

/**
 * Cria um novo documento no sistema.
 */
export async function createDocument(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const parsed = createDocumentSchema.parse(req.body);

    let parsedSuggestions: any = null;
    if (parsed.extractionSuggestions) {
      if (parsed.extractionConfirmed !== 'true') {
        if (req.file) await deleteUploadedFile(req.file.filename);
        res.status(400).json({
          error: 'EXTRACTION_CONFIRMATION_REQUIRED',
          message: 'A confirmação humana das sugestões de extração é obrigatória.',
        });
        return;
      }
      try {
        parsedSuggestions = JSON.parse(parsed.extractionSuggestions);
      } catch {
        if (req.file) await deleteUploadedFile(req.file.filename);
        res.status(400).json({
          error: 'INVALID_SUGGESTIONS_JSON',
          message: 'O campo extractionSuggestions deve conter um JSON válido.',
        });
        return;
      }
    }

    // Validação da regra RN-004: Condicional de Responsável x Configuração da Empresa
    const companyConfig = await prisma.companyConfig.findFirst();
    if (companyConfig?.notificationMode === NotificationMode.ONLY_RESPONSIBLE) {
      if (!parsed.responsibleName || !parsed.responsibleEmail) {
        if (req.file) await deleteUploadedFile(req.file.filename);
        res.status(400).json({
          error: 'RESPONSIBLE_REQUIRED',
          message:
            'O nome e o e-mail do responsável são obrigatórios quando a empresa está configurada no modo "Apenas Responsável".',
        });
        return;
      }
    }

    // Validação de existência da categoria
    const category = await prisma.documentCategory.findUnique({
      where: { id: parsed.categoryId },
    });

    if (!category) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(404).json({
        error: 'CATEGORY_NOT_FOUND',
        message: 'Categoria de documento não encontrada.',
      });
      return;
    }

    // Cálculo do status visual inicial com base na matriz de cores (RN-001)
    const expirationDate = parsed.expirationDate ? new Date(parsed.expirationDate) : null;
    const initialStatus = calculateDocumentStatus(
      expirationDate,
      parsed.alertLeadDays,
      parsed.isRenewalInProgress
    );

    // Persistência atômica do documento e trilha de auditoria (RN-008)
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          title: parsed.title,
          categoryId: parsed.categoryId,
          issuingBody: parsed.issuingBody || null,
          issueDate: new Date(parsed.issueDate),
          expirationDate,
          alertLeadDays: parsed.alertLeadDays,
          status: initialStatus,
          responsibleName: parsed.responsibleName || null,
          responsibleEmail: parsed.responsibleEmail || null,
          notes: parsed.notes || null,
          attachmentUrl: req.file ? `/api/v1/uploads/${req.file.filename}` : null,
          attachmentFilename: req.file ? req.file.originalname : null,
          fileSizeBytes: req.file ? req.file.size : null,
          fileMimeType: req.file ? req.file.mimetype : null,
          isArchived: false,
          createdById: req.user!.userId,
        },
        include: {
          category: true,
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      const diffData: Record<string, any> = {
        title: { new: created.title },
        categoryId: { new: created.categoryId },
        issueDate: { new: created.issueDate },
        expirationDate: { new: created.expirationDate },
        status: { new: created.status },
        alertLeadDays: { new: created.alertLeadDays },
        attachmentFilename: { new: created.attachmentFilename },
      };

      if (parsedSuggestions && typeof parsedSuggestions === 'object') {
        const fields = parsedSuggestions.fields || {};

        const toDateString = (d: Date | string | null | undefined): string | null => {
          if (!d) return null;
          if (typeof d === 'string') {
            const trimmed = d.trim().slice(0, 10);
            return trimmed || null;
          }
          if (d instanceof Date && !isNaN(d.getTime())) {
            return d.toISOString().slice(0, 10);
          }
          return null;
        };

        const savedIssueDate = toDateString(created.issueDate);
        const suggestedIssueDate = toDateString(fields.issueDate?.value);
        const isIssueDateAuto =
          suggestedIssueDate !== null &&
          savedIssueDate !== null &&
          suggestedIssueDate === savedIssueDate;

        const savedExpDate = toDateString(created.expirationDate);
        const suggestedExpDate = toDateString(fields.expirationDate?.value);
        const isExpDateAuto =
          suggestedExpDate !== null &&
          savedExpDate !== null &&
          suggestedExpDate === savedExpDate;

        const savedIssuingBody = (created.issuingBody || '').trim();
        const suggestedIssuingBody = (fields.issuingBody?.value || '').trim();
        const isIssuingBodyAuto =
          suggestedIssuingBody !== '' &&
          savedIssuingBody !== '' &&
          suggestedIssuingBody === savedIssuingBody;

        diffData.fieldOrigins = {
          issueDate: isIssueDateAuto ? 'AUTO' : 'MANUAL',
          expirationDate: isExpDateAuto ? 'AUTO' : 'MANUAL',
          issuingBody: isIssuingBodyAuto ? 'AUTO' : 'MANUAL',
        };

        diffData.extraction = {
          engine: parsedSuggestions.engine ?? 'unknown',
          confidence: {
            issueDate: fields.issueDate?.confidence ?? 0,
            expirationDate: fields.expirationDate?.confidence ?? 0,
            issuingBody: fields.issuingBody?.confidence ?? 0,
          },
        };
      }

      await tx.auditLog.create({
        data: {
          documentId: created.id,
          userId: req.user!.userId,
          userName: req.user!.name,
          action: AuditAction.CREATE,
          diffData,
        },
      });

      return created;
    });

    // Dispara a sincronização automática com o Google Agenda (RN-007). Nunca deve
    // impedir a resposta de sucesso da criação do documento: o próprio
    // `syncDocumentEvent` já trata falhas internamente e grava `GCalSyncLog` com
    // `ERROR`, mas o try/catch aqui é defensivo contra qualquer exceção inesperada.
    if (document.expirationDate) {
      try {
        await syncDocumentEvent(document, 'create');
      } catch (error) {
        console.error('Falha ao sincronizar evento no Google Agenda ao criar documento:', error);
      }
    }

    res.status(201).json({
      message: 'Documento cadastrado com sucesso.',
      document,
    });
  } catch (error) {
    if (req.file) {
      await deleteUploadedFile(req.file.filename);
    }
    next(error);
  }
}

/**
 * Lista os documentos cadastrados com filtros e controle de visibilidade RBAC.
 */
export async function listDocuments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const { categoryId, status, search, includeArchived } = req.query;

    const where: Prisma.DocumentWhereInput = {};

    // Regra RBAC para documentos arquivados:
    // Apenas ADMIN com includeArchived=true pode visualizar documentos arquivados.
    // Usuários OPERATIONAL NUNCA visualizam documentos arquivados.
    const isAdmin = req.user.role === Role.ADMIN;
    const wantsArchived = includeArchived === 'true';

    if (isAdmin && wantsArchived) {
      // Se for admin e pediu arquivados, exibe todos
    } else {
      where.isArchived = false;
    }

    if (categoryId && typeof categoryId === 'string') {
      where.categoryId = categoryId;
    }

    if (status && typeof status === 'string') {
      if (Object.values(DocumentStatus).includes(status as DocumentStatus)) {
        where.status = status as DocumentStatus;
      }
    }

    if (search && typeof search === 'string') {
      const query = search.trim();
      if (query.length > 0) {
        where.OR = [
          { title: { contains: query, mode: 'insensitive' } },
          { issuingBody: { contains: query, mode: 'insensitive' } },
          { responsibleName: { contains: query, mode: 'insensitive' } },
          { notes: { contains: query, mode: 'insensitive' } },
        ];
      }
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: {
          category: true,
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
          versions: {
            orderBy: { versionNumber: 'desc' },
          },
          _count: {
            select: { versions: true, auditLogs: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.count({ where }),
    ]);

    res.status(200).json({
      documents,
      total,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtém detalhes completos de um documento por ID.
 */
export async function getDocumentById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        category: true,
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        versions: {
          include: {
            renewedBy: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { versionNumber: 'desc' },
        },
        auditLogs: {
          orderBy: { timestamp: 'desc' },
        },
        gcalSyncLogs: {
          orderBy: { lastSyncedAt: 'desc' },
        },
      },
    });

    if (!document) {
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    // Se estiver arquivado e o usuário for OPERATIONAL, retorna 404 (oculto)
    if (document.isArchived && req.user.role === Role.OPERATIONAL) {
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    res.status(200).json({ document });
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza os dados de um documento e recalcula seu status visual.
 */
export async function updateDocument(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const existingDoc = await prisma.document.findUnique({
      where: { id },
    });

    if (!existingDoc) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    // Bloqueia acesso operacional a documentos arquivados
    if (existingDoc.isArchived && req.user.role === Role.OPERATIONAL) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    const parsed = updateDocumentSchema.parse(req.body);

    // Se a categoria for alterada, valida existência
    if (parsed.categoryId && parsed.categoryId !== existingDoc.categoryId) {
      const category = await prisma.documentCategory.findUnique({
        where: { id: parsed.categoryId },
      });
      if (!category) {
        if (req.file) await deleteUploadedFile(req.file.filename);
        res.status(404).json({
          error: 'CATEGORY_NOT_FOUND',
          message: 'Categoria de documento não encontrada.',
        });
        return;
      }
    }

    // Valida regra RN-004 se alterando responsável
    const companyConfig = await prisma.companyConfig.findFirst();
    if (companyConfig?.notificationMode === NotificationMode.ONLY_RESPONSIBLE) {
      const finalRespName =
        parsed.responsibleName !== undefined ? parsed.responsibleName : existingDoc.responsibleName;
      const finalRespEmail =
        parsed.responsibleEmail !== undefined ? parsed.responsibleEmail : existingDoc.responsibleEmail;

      if (!finalRespName || !finalRespEmail) {
        if (req.file) await deleteUploadedFile(req.file.filename);
        res.status(400).json({
          error: 'RESPONSIBLE_REQUIRED',
          message:
            'O nome e o e-mail do responsável são obrigatórios quando a empresa está configurada no modo "Apenas Responsável".',
        });
        return;
      }
    }

    // Determina nova data de expiração e prazo de alerta
    const finalExpirationDate =
      parsed.expirationDate !== undefined
        ? parsed.expirationDate
          ? new Date(parsed.expirationDate)
          : null
        : existingDoc.expirationDate;

    const finalAlertLeadDays =
      parsed.alertLeadDays !== undefined ? parsed.alertLeadDays : existingDoc.alertLeadDays;

    const isRenewal =
      parsed.isRenewalInProgress !== undefined
        ? parsed.isRenewalInProgress
        : existingDoc.status === DocumentStatus.RENEWAL_IN_PROGRESS;

    const newStatus =
      parsed.status && parsed.status === DocumentStatus.RENEWAL_IN_PROGRESS
        ? DocumentStatus.RENEWAL_IN_PROGRESS
        : calculateDocumentStatus(finalExpirationDate, finalAlertLeadDays, isRenewal);

    // Mapeia diferenças para o Audit Log (RN-008)
    const diffData: Record<string, { old: any; new: any }> = {};

    if (parsed.title !== undefined && parsed.title !== existingDoc.title) {
      diffData.title = { old: existingDoc.title, new: parsed.title };
    }
    if (parsed.categoryId !== undefined && parsed.categoryId !== existingDoc.categoryId) {
      diffData.categoryId = { old: existingDoc.categoryId, new: parsed.categoryId };
    }
    if (parsed.issuingBody !== undefined && parsed.issuingBody !== existingDoc.issuingBody) {
      diffData.issuingBody = { old: existingDoc.issuingBody, new: parsed.issuingBody };
    }
    if (parsed.issueDate !== undefined) {
      const oldIssueIso = existingDoc.issueDate.toISOString().split('T')[0];
      const newIssueIso = new Date(parsed.issueDate).toISOString().split('T')[0];
      if (oldIssueIso !== newIssueIso) {
        diffData.issueDate = { old: existingDoc.issueDate, new: new Date(parsed.issueDate) };
      }
    }
    if (parsed.expirationDate !== undefined) {
      const oldExpIso = existingDoc.expirationDate ? existingDoc.expirationDate.toISOString().split('T')[0] : null;
      const newExpIso = finalExpirationDate ? finalExpirationDate.toISOString().split('T')[0] : null;
      if (oldExpIso !== newExpIso) {
        diffData.expirationDate = { old: existingDoc.expirationDate, new: finalExpirationDate };
      }
    }
    if (parsed.alertLeadDays !== undefined && parsed.alertLeadDays !== existingDoc.alertLeadDays) {
      diffData.alertLeadDays = { old: existingDoc.alertLeadDays, new: parsed.alertLeadDays };
    }
    if (newStatus !== existingDoc.status) {
      diffData.status = { old: existingDoc.status, new: newStatus };
    }
    if (parsed.responsibleName !== undefined && parsed.responsibleName !== existingDoc.responsibleName) {
      diffData.responsibleName = { old: existingDoc.responsibleName, new: parsed.responsibleName };
    }
    if (parsed.responsibleEmail !== undefined && parsed.responsibleEmail !== existingDoc.responsibleEmail) {
      diffData.responsibleEmail = { old: existingDoc.responsibleEmail, new: parsed.responsibleEmail };
    }
    if (parsed.notes !== undefined && parsed.notes !== existingDoc.notes) {
      diffData.notes = { old: existingDoc.notes, new: parsed.notes };
    }
    if (req.file) {
      diffData.attachmentFilename = { old: existingDoc.attachmentFilename, new: req.file.originalname };
    }

    // Atualiza documento
    const updatedDocument = await prisma.document.update({
      where: { id },
      data: {
        ...(parsed.title !== undefined && { title: parsed.title }),
        ...(parsed.categoryId !== undefined && { categoryId: parsed.categoryId }),
        ...(parsed.issuingBody !== undefined && { issuingBody: parsed.issuingBody }),
        ...(parsed.issueDate !== undefined && { issueDate: new Date(parsed.issueDate) }),
        ...(parsed.expirationDate !== undefined && { expirationDate: finalExpirationDate }),
        ...(parsed.alertLeadDays !== undefined && { alertLeadDays: parsed.alertLeadDays }),
        status: newStatus,
        ...(parsed.responsibleName !== undefined && { responsibleName: parsed.responsibleName }),
        ...(parsed.responsibleEmail !== undefined && { responsibleEmail: parsed.responsibleEmail }),
        ...(parsed.notes !== undefined && { notes: parsed.notes }),
        ...(req.file && {
          attachmentUrl: `/api/v1/uploads/${req.file.filename}`,
          attachmentFilename: req.file.originalname,
          fileSizeBytes: req.file.size,
          fileMimeType: req.file.mimetype,
        }),
      },
      include: {
        category: true,
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Registra auditoria caso tenha havido alterações
    if (Object.keys(diffData).length > 0) {
      await prisma.auditLog.create({
        data: {
          documentId: updatedDocument.id,
          userId: req.user.userId,
          userName: req.user.name,
          action: AuditAction.UPDATE,
          diffData,
        },
      });
    }

    // Remove anexo anterior do disco se substituído (somente após persistência com sucesso)
    if (req.file && existingDoc.attachmentUrl) {
      await deleteUploadedFile(existingDoc.attachmentUrl);
    }

    // Dispara a sincronização automática com o Google Agenda (RN-007). Escolha de
    // gatilho: restrito a quando a data de vencimento efetivamente mudou
    // (`diffData.expirationDate` presente), em vez de sincronizar em qualquer
    // edição do documento — mais fiel à redação literal da RN-007 ("criação ou
    // alteração da data de vencimento") e evita chamadas de rede desnecessárias à
    // API do Google a cada edição de campos não relacionados (ex.: notas). Mesma
    // regra de não-bloqueio de `createDocument`.
    if (diffData.expirationDate && updatedDocument.expirationDate) {
      try {
        await syncDocumentEvent(updatedDocument, 'update');
      } catch (error) {
        console.error('Falha ao sincronizar evento no Google Agenda ao atualizar documento:', error);
      }
    }

    res.status(200).json({
      message: 'Documento atualizado com sucesso.',
      document: updatedDocument,
    });
  } catch (error) {
    if (req.file) {
      await deleteUploadedFile(req.file.filename);
    }
    next(error);
  }
}

/**
 * Alterna o estado de arquivamento de um documento (Soft Delete / Desarquivamento).
 */
export async function toggleArchive(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    // Se estiver arquivado e usuário for OPERATIONAL, não permite localizar/desarquivar
    if (document.isArchived && req.user.role === Role.OPERATIONAL) {
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    const newIsArchived = !document.isArchived;
    const action = newIsArchived ? AuditAction.ARCHIVE : AuditAction.UNARCHIVE;

    const updatedDocument = await prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: { isArchived: newIsArchived },
        include: {
          category: true,
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      // Registra ação de auditoria
      await tx.auditLog.create({
        data: {
          documentId: document.id,
          userId: req.user!.userId,
          userName: req.user!.name,
          action,
          diffData: {
            isArchived: { old: document.isArchived, new: newIsArchived },
          },
        },
      });

      return updated;
    });

    // Reflete o (des)arquivamento no Google Agenda (DOC-28, escopo do ticket:
    // "Arquivar/excluir um documento remove ou cancela o evento correspondente").
    // Ao arquivar, remove o evento existente. Ao desarquivar, opcionalmente
    // recria o evento (não exigido explicitamente pela tarefa, mas mantém o
    // Google Agenda consistente com o estado do documento em vez de deixá-lo sem
    // evento até a próxima edição). Mesma regra de não-bloqueio: falha aqui nunca
    // deve impedir a resposta de sucesso do (des)arquivamento.
    try {
      if (newIsArchived) {
        await deleteDocumentEvent(document);
      } else if (updatedDocument.expirationDate) {
        await syncDocumentEvent(updatedDocument, 'update');
      }
    } catch (error) {
      console.error('Falha ao sincronizar Google Agenda ao alternar arquivamento do documento:', error);
    }

    res.status(200).json({
      message: newIsArchived ? 'Documento arquivado com sucesso.' : 'Documento desarquivado com sucesso.',
      document: updatedDocument,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Exclui permanentemente um documento e seu anexo físico do storage (Hard Delete - Apenas Admin).
 */
export async function deleteDocument(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    // Remove/cancela o evento no Google Agenda ANTES do hard delete: `GCalSyncLog`
    // tem `onDelete: Cascade` para `Document`, então depois de `prisma.document.delete`
    // o histórico de sincronização já não existe mais e `deleteDocumentEvent` não
    // encontraria nada para remover. Falha aqui não deve impedir a exclusão.
    try {
      await deleteDocumentEvent(document);
    } catch (error) {
      console.error('Falha ao remover evento no Google Agenda antes de excluir documento:', error);
    }

    // Persistência atômica da auditoria e exclusão do documento (RN-008)
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          documentId: null,
          userId: req.user!.userId,
          userName: req.user!.name,
          action: AuditAction.DELETE,
          diffData: {
            deletedDocumentId: { old: document.id },
            title: { old: document.title },
          },
        },
      });

      // Hard delete no banco de dados (cascateia versions e gcal logs)
      await tx.document.delete({
        where: { id },
      });
    });

    // Efeitos externos executados somente após o commit da transação:
    // Se possuir anexo físico salvo, remove do disco
    if (document.attachmentUrl) {
      await deleteUploadedFile(document.attachmentUrl);
    }

    res.status(200).json({
      message: 'Documento excluído permanentemente com sucesso.',
    });
  } catch (error) {
    next(error);
  }
}

// Schema de validação para renovação de documento
const renewDocumentSchema = z.object({
  issueDate: z
    .string({ required_error: 'A nova data de emissão é obrigatória.' })
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Data de emissão inválida.',
    }),
  expirationDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim()))
    .refine((val) => val === null || !isNaN(Date.parse(val)), {
      message: 'Data de vencimento inválida.',
    }),
  notes: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (!val || val.trim() === '' ? null : val.trim())),
});

/**
 * Renova um documento arquivando a versão vigente na tabela document_versions
 * e atualizando o documento com novas datas, anexo e recálculo de status (RF-003, RN-002, RN-008).
 */
export async function renewDocument(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    if (document.isArchived && req.user.role === Role.OPERATIONAL) {
      if (req.file) await deleteUploadedFile(req.file.filename);
      res.status(404).json({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Documento não encontrado.',
      });
      return;
    }

    const parsed = renewDocumentSchema.parse(req.body);
    const finalExpirationDate = parsed.expirationDate ? new Date(parsed.expirationDate) : null;
    const newStatus = calculateDocumentStatus(finalExpirationDate, document.alertLeadDays, false);

    const MAX_RETRIES = 3;
    let resultData: { updatedDocument: any; versionNumber: number } | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        resultData = await prisma.$transaction(async (tx) => {
          // Calcula o próximo número de versão como max(versionNumber) + 1
          const aggregateResult = await tx.documentVersion.aggregate({
            where: { documentId: document.id },
            _max: { versionNumber: true },
          });
          const versionNumber = (aggregateResult._max.versionNumber ?? 0) + 1;

          // 1. Arquiva snapshot da versão anterior no histórico imutável (RN-002)
          await tx.documentVersion.create({
            data: {
              documentId: document.id,
              versionNumber,
              issueDate: document.issueDate,
              expirationDate: document.expirationDate,
              attachmentUrl: document.attachmentUrl,
              attachmentFilename: document.attachmentFilename,
              notes: document.notes,
              renewedById: req.user!.userId,
            },
          });

          // 2. Atualiza documento vigente com novos parâmetros
          const updatedDocument = await tx.document.update({
            where: { id: document.id },
            data: {
              issueDate: new Date(parsed.issueDate),
              expirationDate: finalExpirationDate,
              status: newStatus,
              notes: parsed.notes !== undefined && parsed.notes !== null ? parsed.notes : document.notes,
              ...(req.file && {
                attachmentUrl: `/api/v1/uploads/${req.file.filename}`,
                attachmentFilename: req.file.originalname,
                fileSizeBytes: req.file.size,
                fileMimeType: req.file.mimetype,
              }),
            },
            include: {
              category: true,
              createdBy: {
                select: { id: true, name: true, email: true, role: true },
              },
              versions: {
                orderBy: { versionNumber: 'desc' },
                include: {
                  renewedBy: {
                    select: { id: true, name: true, email: true },
                  },
                },
              },
            },
          });

          // 3. Registra na trilha de auditoria (action: RENEW, RN-008)
          await tx.auditLog.create({
            data: {
              documentId: document.id,
              userId: req.user!.userId,
              userName: req.user!.name,
              action: AuditAction.RENEW,
              diffData: {
                archivedVersionNumber: { old: null, new: versionNumber },
                issueDate: { old: document.issueDate, new: new Date(parsed.issueDate) },
                expirationDate: { old: document.expirationDate, new: finalExpirationDate },
                status: { old: document.status, new: newStatus },
                ...(req.file && {
                  attachmentFilename: { old: document.attachmentFilename, new: req.file.originalname },
                }),
              },
            },
          });

          return { updatedDocument, versionNumber };
        });

        // Transação completada com sucesso
        break;
      } catch (error) {
        lastError = error;
        if (isPrismaP2002Error(error) && attempt < MAX_RETRIES) {
          // Conflito de concorrência no número de versão: tenta novamente
          continue;
        }
        break;
      }
    }

    if (!resultData) {
      if (req.file) {
        await deleteUploadedFile(req.file.filename);
      }
      if (isPrismaP2002Error(lastError)) {
        res.status(409).json({
          error: 'VERSION_CONFLICT',
          message: 'Conflito de concorrência ao renovar o documento. Por favor, tente novamente.',
        });
        return;
      }
      next(lastError);
      return;
    }

    res.status(200).json({
      message: 'Documento renovado com sucesso. A versão anterior foi arquivada no histórico.',
      document: resultData.updatedDocument,
      previousVersionNumber: resultData.versionNumber,
    });
  } catch (error) {
    if (req.file) {
      await deleteUploadedFile(req.file.filename);
    }
    next(error);
  }
}

/**
 * Retorna o histórico de todas as versões anteriores de um documento.
 */
export async function getDocumentVersions(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, title: true, isArchived: true },
    });

    if (!document || (document.isArchived && req.user.role === Role.OPERATIONAL)) {
      res.status(404).json({ error: 'DOCUMENT_NOT_FOUND', message: 'Documento não encontrado.' });
      return;
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNumber: 'desc' },
      include: {
        renewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(200).json({ documentId: id, versions });
  } catch (error) {
    next(error);
  }
}

/**
 * Endpoint de extração automática de campos a partir do anexo enviado.
 * Recebe o anexo em memória, valida magic bytes e chama o serviço de extração.
 * Não grava nada em disco nem persiste no banco de dados.
 */
export async function extractDocumentFields(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuário não autenticado.' });
      return;
    }

    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({
        error: 'FILE_REQUIRED',
        message: 'Nenhum arquivo enviado para extração.',
      });
      return;
    }

    const detected = detectFileType(req.file.buffer);
    if (!detected) {
      res.status(400).json({
        error: 'INVALID_FILE_TYPE',
        message: 'Tipo de arquivo não permitido: o conteúdo do arquivo não corresponde a um PDF, PNG ou JPEG. Formatos aceitos: PDF, PNG, JPEG, JPG.',
      });
      return;
    }

    if (!env.EXTRACTION_SERVICE_URL || env.EXTRACTION_SERVICE_URL.trim() === '') {
      res.status(503).json({ message: 'Serviço de extração indisponível' });
      return;
    }

    try {
      const result = await extractFromBuffer(req.file.buffer, detected.mime);
      res.status(200).json(result);
    } catch (err) {
      if (env.NODE_ENV !== 'test') {
        console.error('⚠️ [Extraction] Falha na comunicação com serviço de extração:', err);
      }
      res.status(503).json({ message: 'Serviço de extração indisponível' });
    }
  } catch (error) {
    next(error);
  }
}
