import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentFilters from '@/features/documents/components/DocumentFilters';
import DocumentFormModal from '@/features/documents/components/DocumentFormModal';
import DocumentRenewModal from '@/features/documents/components/DocumentRenewModal';
import FileDropzone from '@/features/documents/components/FileDropzone';
import { companyService } from '@/features/documents/services/companyService';
import { toInputDateFormat, toLocalInputDateFormat } from '@/features/documents/utils/dateHelper';
import { buildCreateFormData, buildRenewFormData, buildUpdateFormData } from '@/features/documents/utils/formDataHelper';

vi.mock('@/features/documents/services/companyService', () => ({
  companyService: {
    getConfig: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DocumentFilters', () => {
  const props = () => ({ search: '', onSearchChange: vi.fn(), categoryId: '', onCategoryChange: vi.fn(), status: '' as const, onStatusChange: vi.fn(), includeArchived: false, onIncludeArchivedChange: vi.fn(), categories: [{ id: 'cat-1', name: 'Licenças', colorHex: null, description: null }], isAdmin: true, totalCount: 1 });

  it('aplica busca com debounce e filtros de categoria/status', async () => {
    vi.useFakeTimers(); const p = props();
    render(<DocumentFilters {...p} />);
    fireEvent.change(screen.getByPlaceholderText(/buscar por título/i), { target: { value: 'alvará' } });
    expect(p.onSearchChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(p.onSearchChange).toHaveBeenLastCalledWith('alvará');
    fireEvent.change(screen.getByDisplayValue('Todas as Categorias'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByDisplayValue('Todos os Status'), { target: { value: 'CRITICAL' } });
    expect(p.onCategoryChange).toHaveBeenCalledWith('cat-1');
    expect(p.onStatusChange).toHaveBeenCalledWith('CRITICAL');
    vi.useRealTimers();
  });

  it('restringe o toggle de arquivados a ADMIN e encaminha sua alteração', async () => {
    const p = props(); const { rerender } = render(<DocumentFilters {...p} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(p.onIncludeArchivedChange).toHaveBeenCalledWith(true);
    rerender(<DocumentFilters {...p} isAdmin={false} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('FileDropzone', () => {
  const renderDropzone = () => { const onFileSelect = vi.fn(); render(<FileDropzone selectedFile={null} onFileSelect={onFileSelect} />); return onFileSelect; };
  it('aceita PDF por drop e por interação acessível de teclado', () => {
    const onFileSelect = renderDropzone(); const zone = screen.getByRole('button', { name: /área de upload/i });
    const pdf = new File(['pdf'], 'licenca.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone, { dataTransfer: { files: [pdf] } });
    expect(onFileSelect).toHaveBeenCalledWith(pdf);
    const input = screen.getByLabelText(/upload de anexo/i); const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(zone, { key: 'Enter' });
    expect(click).toHaveBeenCalled();
  });
  it('rejeita formato inválido e arquivo superior a 10 MB', () => {
    const onFileSelect = renderDropzone(); const zone = screen.getByRole('button');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'malware.exe', { type: 'application/octet-stream' })] } });
    expect(screen.getByText(/formato não suportado/i)).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText(/excede o limite máximo/i)).toBeInTheDocument();
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});

describe('formDataHelper', () => {
  const base = { title: ' Documento ', categoryId: 'cat-1', issueDate: '2026-08-27' };
  it('omite campos opcionais vazios no POST e converte booleanos em strings', () => {
    const fd = buildCreateFormData({ ...base, issuingBody: '', expirationDate: null, responsibleName: null, responsibleEmail: '', isRenewalInProgress: false });
    expect(Object.fromEntries(fd.entries())).toMatchObject({ title: 'Documento', categoryId: 'cat-1', isRenewalInProgress: 'false' });
    expect(fd.has('expirationDate')).toBe(false);
  });
  it('envia strings vazias para limpar campos no PUT e flags de renovação', () => {
    const fd = buildUpdateFormData({ ...base, issuingBody: null, expirationDate: '', responsibleName: '', responsibleEmail: null, notes: '', isRenewalInProgress: true });
    expect(Object.fromEntries(fd.entries())).toMatchObject({ issuingBody: '', expirationDate: '', responsibleName: '', responsibleEmail: '', notes: '', status: 'RENEWAL_IN_PROGRESS', isRenewalInProgress: 'true' });
  });
  it('preserva datas opcionais e anexo no payload de renovação', () => {
    const attachment = new File(['new'], 'novo.jpg', { type: 'image/jpeg' });
    const fd = buildRenewFormData({ issueDate: '2026-09-01', expirationDate: '', notes: '', attachment });
    expect(fd.get('issueDate')).toBe('2026-09-01'); expect(fd.get('expirationDate')).toBe(''); expect(fd.get('attachment')).toBe(attachment);
  });
});

describe('DOC-40 - data de emissão padrão usa o dia civil local do navegador', () => {
  const categories = [{ id: 'cat-1', name: 'Licenças', colorHex: '#3b82f6', description: null }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(companyService.getConfig).mockResolvedValue({
      id: 'cfg-1',
      notificationMode: 'ALL_ADMINS',
      alertLeadDays: 30,
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:00.000Z',
    });
  });

  it('às 22:00 em America/Sao_Paulo (2026-10-14T01:00:00Z) preenche 2026-10-13 no cadastro e na renovação', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T01:00:00Z'));

    expect(toLocalInputDateFormat(new Date())).toBe('2026-10-13');
    // Datas civis vindas da API em meia-noite UTC continuam intactas
    expect(toInputDateFormat('2026-10-14T00:00:00.000Z')).toBe('2026-10-14');

    const { unmount } = render(
      <DocumentFormModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        categories={categories}
        documentToEdit={null}
      />
    );
    await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

    const createIssueInput = screen.getByLabelText(/Data de Emissão/i) as HTMLInputElement;
    expect(createIssueInput.value).toBe('2026-10-13');
    unmount();

    render(
      <DocumentRenewModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        document={{
          id: 'doc-1',
          title: 'Alvará',
          categoryId: 'cat-1',
          issuingBody: 'Prefeitura',
          issueDate: '2025-10-13T00:00:00.000Z',
          expirationDate: '2026-10-13T00:00:00.000Z',
          alertLeadDays: 30,
          status: 'CRITICAL',
          responsibleName: null,
          responsibleEmail: null,
          attachmentUrl: null,
          attachmentFilename: null,
          fileSizeBytes: null,
          fileMimeType: null,
          notes: null,
          isArchived: false,
          createdById: 'u-1',
          createdAt: '2025-10-13T00:00:00.000Z',
          updatedAt: '2025-10-13T00:00:00.000Z',
        }}
      />
    );

    const renewIssueInput = screen.getByLabelText(/Nova Data de Emissão/i) as HTMLInputElement;
    expect(renewIssueInput.value).toBe('2026-10-13');
  });
});
