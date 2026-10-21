import { describe, it, expect } from 'vitest';
import {
  getRequest,
  getApiPath,
  getAuthTokens,
  getCategoryId,
  isoDateFromNow,
  minimalPdfPath,
  uniqueValue,
} from './helpers/auth.helper.js';

describe('TC-E2E-09: Extração de documentos no stack padrão sem perfil', () => {
  const req = getRequest();

  it('responde 503 em POST /documents/extract quando serviço está desligado e mantém cadastro manual 201', async () => {
    const { adminToken } = await getAuthTokens();
    const categoryId = await getCategoryId(adminToken);

    // 1. No stack padrão (sem o perfil extraction), POST /documents/extract responde 503
    const extractRes = await req
      .post(getApiPath('/api/v1/documents/extract'))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('attachment', minimalPdfPath, {
        filename: 'anexo-extracao.pdf',
        contentType: 'application/pdf',
      });

    expect(extractRes.status).toBe(503);
    expect(extractRes.body).toMatchObject({
      message: 'Serviço de extração indisponível',
    });

    // 2. Cadastro manual continua funcionando normalmente (201)
    const title = uniqueValue('doc-manual-sem-extracao');
    const createRes = await req
      .post(getApiPath('/api/v1/documents'))
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', title)
      .field('categoryId', categoryId)
      .field('issueDate', isoDateFromNow(-5))
      .field('expirationDate', isoDateFromNow(60))
      .field('alertLeadDays', '30')
      .attach('attachment', minimalPdfPath, {
        filename: 'manual.pdf',
        contentType: 'application/pdf',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.document).toMatchObject({
      title,
      status: 'REGULAR',
    });
  });
});
