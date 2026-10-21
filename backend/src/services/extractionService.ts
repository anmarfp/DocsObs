import { z } from 'zod';
import { env } from '../config/env.js';

/**
 * Schema Zod para validação da resposta retornada pelo serviço Python de extração.
 */
export const PythonExtractionResponseSchema = z.object({
  engine: z.string(),
  engine_version: z.string(),
  elapsed_s: z.number().optional(),
  fields: z.object({
    issueDate: z.object({
      value: z.string().nullable(),
      confidence: z.number(),
    }),
    expirationDate: z.object({
      value: z.string().nullable(),
      confidence: z.number(),
    }),
    issuingBody: z.object({
      value: z.string().nullable(),
      confidence: z.number(),
    }),
  }),
});

export type PythonExtractionResponse = z.infer<typeof PythonExtractionResponseSchema>;

export interface ExtractionFields {
  issueDate: { value: string | null; confidence: number };
  expirationDate: { value: string | null; confidence: number };
  issuingBody: { value: string | null; confidence: number };
}

export interface ExtractionResult {
  engine: string;
  engineVersion: string;
  fields: ExtractionFields;
}

/**
 * Cliente HTTP para o microserviço de extração OCR/IA.
 * Envia o buffer bruto com fetch nativo do Node 20 e AbortController para timeout.
 */
export async function extractFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  const serviceUrl = env.EXTRACTION_SERVICE_URL;
  if (!serviceUrl || serviceUrl.trim() === '') {
    throw new Error('EXTRACTION_SERVICE_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeoutMs = env.EXTRACTION_TIMEOUT_MS || 60000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `${serviceUrl.replace(/\/+$/, '')}/extract`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
      },
      body: buffer,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Extraction service returned HTTP ${response.status}`);
    }

    const json = await response.json();
    const parsed = PythonExtractionResponseSchema.parse(json);

    return {
      engine: parsed.engine,
      engineVersion: parsed.engine_version,
      fields: parsed.fields,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
