import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn() },
}));

import api from '@/services/api';
import {
  documentService,
  resolveAttachmentBlobType,
} from '@/features/documents/services/documentService';

describe('DOC-34 - tipo do Blob de anexos derivado de allow-list', () => {
  it('mantém apenas PDF, PNG e JPEG; o resto vira application/octet-stream', () => {
    expect(resolveAttachmentBlobType('application/pdf')).toBe('application/pdf');
    expect(resolveAttachmentBlobType('image/png')).toBe('image/png');
    expect(resolveAttachmentBlobType('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
    expect(resolveAttachmentBlobType('text/html; charset=UTF-8')).toBe('application/octet-stream');
    expect(resolveAttachmentBlobType('image/svg+xml')).toBe('application/octet-stream');
    expect(resolveAttachmentBlobType(undefined)).toBe('application/octet-stream');
  });

  describe('previewAttachment', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createObjectURL = vi.fn(() => 'blob:mock');
      Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('não cria Blob text/html mesmo que o servidor responda text/html', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: '<script>alert(1)</script>',
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      } as never);

      await documentService.previewAttachment('/api/v1/uploads/legado.html');

      expect(api.get).toHaveBeenCalledWith('/uploads/legado.html', { responseType: 'blob' });
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/octet-stream');
      expect(openSpy).toHaveBeenCalledWith('blob:mock', '_blank');
    });

    it('preserva a visualização de PDF', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: '%PDF-1.4',
        headers: { 'content-type': 'application/pdf' },
      } as never);

      await documentService.previewAttachment('/api/v1/uploads/doc.pdf');

      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/pdf');
    });
  });
});
