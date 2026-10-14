import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';

// Respeita UPLOAD_DIR via variável de ambiente ou usa ./uploads local
export const UPLOADS_DIR = path.resolve(env.UPLOAD_DIR);

// Respeita MAX_FILE_SIZE_BYTES via variável de ambiente (padrão 10 MB = 10.485.760 bytes)
export const MAX_FILE_SIZE = env.MAX_FILE_SIZE_BYTES;

// MIME types aceitos como DECLARAÇÃO do cliente (pré-filtro). A decisão final é
// feita pelos magic bytes do conteúdo (ver `detectFileType`).
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
];

/**
 * Allow-list interna dos tipos de anexo. O tipo é detectado no servidor pelos
 * magic bytes; a extensão gravada em disco deriva SOMENTE do tipo detectado,
 * nunca de `originalname` (que permanece apenas como metadado).
 */
export interface DetectedFileType {
  mime: 'application/pdf' | 'image/png' | 'image/jpeg';
  ext: '.pdf' | '.png' | '.jpg';
}

const FILE_SIGNATURES: Array<DetectedFileType & { magic: number[] }> = [
  { mime: 'application/pdf', ext: '.pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
];

/**
 * Extensões que podem ser servidas por /api/v1/uploads e o Content-Type fixo de
 * cada uma. `.jpeg` é mantida para anexos legados gravados antes do DOC-34.
 */
export const SERVED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Detecta o tipo real do arquivo pelos magic bytes. Retorna `null` quando o
 * conteúdo não corresponde a nenhum tipo permitido (inclusive arquivo vazio).
 */
export function detectFileType(buffer: Buffer | undefined | null): DetectedFileType | null {
  if (!buffer || buffer.length === 0) return null;
  for (const sig of FILE_SIGNATURES) {
    if (buffer.length >= sig.magic.length && sig.magic.every((byte, i) => buffer[i] === byte)) {
      return { mime: sig.mime, ext: sig.ext };
    }
  }
  return null;
}

/** Normaliza o MIME declarado pelo cliente (`image/jpg` é alias de `image/jpeg`). */
function normalizeDeclaredMime(mime: string): string {
  const m = (mime || '').toLowerCase().trim();
  return m === 'image/jpg' ? 'image/jpeg' : m;
}

/**
 * Erro de tipo inválido. O prefixo "Tipo de arquivo não permitido" é mapeado
 * pelo errorHandler para HTTP 400 `INVALID_FILE_TYPE`.
 */
function invalidFileTypeError(detail: string): Error {
  return new Error(
    `Tipo de arquivo não permitido: ${detail}. Formatos aceitos: PDF, PNG, JPEG, JPG.`
  );
}

// Garante que o diretório de uploads exista no filesystem
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Pré-filtro pelo MIME declarado: rejeita cedo, antes de bufferizar o arquivo.
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const mime = file.mimetype.toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(mime)) {
    cb(null, true);
  } else {
    cb(invalidFileTypeError(`"${file.mimetype}"`));
  }
};

// memoryStorage: o arquivo só é gravado em disco depois de validado, então um
// upload rejeitado nunca deixa resíduo no diretório de uploads.
const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter,
});

/**
 * Valida o conteúdo recebido em memória (magic bytes + coerência com o MIME
 * declarado) e grava o arquivo com nome aleatório e extensão derivada do tipo
 * detectado. Preenche `filename`/`path`/`destination` e substitui `mimetype`
 * pelo tipo detectado (canônico).
 */
async function validateAndPersist(file: Express.Multer.File): Promise<void> {
  const detected = detectFileType(file.buffer);
  if (!file.buffer || file.buffer.length === 0) {
    throw invalidFileTypeError('o arquivo está vazio');
  }
  if (!detected) {
    throw invalidFileTypeError(
      `o conteúdo do arquivo não corresponde a um PDF, PNG ou JPEG (declarado: "${file.mimetype}")`
    );
  }
  if (normalizeDeclaredMime(file.mimetype) !== detected.mime) {
    throw invalidFileTypeError(
      `o tipo declarado ("${file.mimetype}") não confere com o conteúdo do arquivo (${detected.mime})`
    );
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  }

  const uniqueHash = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${uniqueHash}${detected.ext}`;
  const fullPath = path.join(UPLOADS_DIR, filename);
  await fs.promises.writeFile(fullPath, file.buffer, { flag: 'wx' });

  file.filename = filename;
  file.path = fullPath;
  file.destination = UPLOADS_DIR;
  file.mimetype = detected.mime;
  file.size = file.buffer.length;
}

/**
 * Middleware de upload com a mesma API usada nas rotas (`upload.single(campo)`).
 * Executa o multer (limite de tamanho + pré-filtro do MIME declarado) e depois
 * a validação por magic bytes, só então gravando o arquivo em disco.
 */
export const upload = {
  single(fieldName: string): RequestHandler {
    const multerSingle = multerInstance.single(fieldName);
    return (req: Request, res: Response, next: NextFunction) => {
      multerSingle(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        if (!req.file) {
          next();
          return;
        }
        validateAndPersist(req.file).then(
          () => next(),
          (validationError: unknown) => {
            req.file = undefined;
            next(validationError);
          }
        );
      });
    };
  },
};

/**
 * Cabeçalhos aplicados a toda resposta que serve um anexo (express.static de
 * /api/v1/uploads). Content-Type fixo pela extensão allow-listed, `nosniff` e
 * `Content-Disposition: attachment` com nome seguro (o nome gerado no servidor).
 */
export function setAttachmentHeaders(res: Response, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = SERVED_CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const safeName = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
}

/**
 * Bloqueia (404) qualquer requisição a /api/v1/uploads cuja extensão não esteja
 * na allow-list, inclusive anexos legados gravados com extensão arbitrária
 * (ex.: `.html`) antes do DOC-34.
 */
export const rejectDisallowedUploadExtension: RequestHandler = (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SERVED_CONTENT_TYPES, ext)) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    return;
  }
  next();
};

/**
 * Remove com segurança um arquivo anexo do disco local.
 */
export async function deleteUploadedFile(fileUrlOrFilename: string | null | undefined): Promise<boolean> {
  if (!fileUrlOrFilename) return false;

  try {
    const filename = path.basename(fileUrlOrFilename);
    const fullPath = path.resolve(UPLOADS_DIR, filename);

    // Proteção contra Directory Traversal
    if (!fullPath.startsWith(UPLOADS_DIR)) {
      console.warn('⚠️ [Storage] Tentativa de exclusão de arquivo fora do diretório de uploads:', fileUrlOrFilename);
      return false;
    }

    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('⚠️ [Storage] Erro ao excluir arquivo anexo:', error);
    return false;
  }
}
