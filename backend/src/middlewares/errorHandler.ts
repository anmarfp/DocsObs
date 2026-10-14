import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { env } from '../config/env.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Dados enviados são inválidos.',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'FILE_TOO_LARGE',
        message: 'O arquivo excede o limite máximo permitido de 10 MB (10.485.760 bytes).',
      });
      return;
    }
    res.status(400).json({
      error: 'UPLOAD_ERROR',
      message: `Erro no upload do arquivo: ${err.message}`,
    });
    return;
  }

  if (err.message && typeof err.message === 'string' && err.message.startsWith('Tipo de arquivo não permitido')) {
    res.status(400).json({
      error: 'INVALID_FILE_TYPE',
      message: err.message,
    });
    return;
  }

  if (env.NODE_ENV !== 'test') {
    console.error('⚠️ [Erro Não Tratado]:', err);
  }

  res.status(err.status || 500).json({
    error: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'Ocorreu um erro interno no servidor.',
  });
}
