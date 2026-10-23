import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as AuthModule from '@/contexts/AuthContext';
import type { AuthContextType, Role, User } from '@/types/auth';
import type { Document } from '@/features/documents/types/document.types';
import DocumentFilters from '@/features/documents/components/DocumentFilters';
import DocumentFormModal from '@/features/documents/components/DocumentFormModal';
import DocumentRenewModal from '@/features/documents/components/DocumentRenewModal';
import FileDropzone from '@/features/documents/components/FileDropzone';
import { documentService } from '@/features/documents/services/documentService';
import { categoryService } from '@/features/documents/services/categoryService';
import { DocumentsPage } from '@/pages/documents/DocumentsPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { Header } from '@/components/layout/Header';
import { buildCreateFormData, buildRenewFormData, buildUpdateFormData } from '@/features/documents/utils/formDataHelper';
import { companyService } from '@/features/documents/services/companyService';
import { toInputDateFormat, toLocalInputDateFormat } from '@/features/documents/utils/dateHelper';

vi.mock('@/features/documents/services/companyService', () => ({
  companyService: {
    getConfig: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

const testUser: User = {
  id: 'admin-1',
  name: 'Ana Admin',
  email: 'ana@docsobs.test',
  role: 'ADMIN',
  isActive: true,
};

function makeAuth(role: Role = 'ADMIN'): AuthContextType {
  return {
    user: { ...testUser, role },
    token: 'jwt',
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  };
}

function renderWithRouterAndAuth(node: React.ReactNode, role: Role = 'ADMIN') {
  vi.spyOn(AuthModule, 'useAuth').mockReturnValue(makeAuth(role));
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function makeDoc(id: string, title: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    title,
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Licenças', colorHex: '#5483B3', description: null },
    issuingBody: 'Prefeitura',
    issueDate: '2026-01-01T00:00:00.000Z',
    expirationDate: '2026-09-01T00:00:00.000Z',
    alertLeadDays: 30,
    status: 'REGULAR',
    responsibleName: null,
    responsibleEmail: null,
    attachmentUrl: null,
    attachmentFilename: null,
    fileSizeBytes: null,
    fileMimeType: null,
    notes: null,
    isArchived: false,
    createdById: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DocumentsPage — paginação e reset de página ao alterar filtros', () => {
  beforeEach(() => {
    vi.spyOn(categoryService, 'getCategories').mockResolvedValue([
      { id: 'cat-1', name: 'Licenças', colorHex: '#5483B3', description: null, documentCount: 25 },
    ]);
  });

  it('navega entre páginas e mantém o total correto', async () => {
    const page1Docs = Array.from({ length: 20 }, (_, i) => makeDoc(`doc-p1-${i + 1}`, `Documento P1-${i + 1}`));
    const page2Docs = Array.from({ length: 5 }, (_, i) => makeDoc(`doc-p2-${i + 1}`, `Documento P2-${i + 1}`));

    const getDocuments = vi.spyOn(documentService, 'getDocuments').mockImplementation(async (params = {}) => {
      const p = params.page ?? 1;
      const lim = params.limit ?? 20;
      return {
        documents: p === 1 ? page1Docs : page2Docs,
        total: 25,
        page: p,
        limit: lim,
      };
    });

    renderWithRouterAndAuth(<DocumentsPage />);

    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenCalledWith({
      search: undefined,
      categoryId: undefined,
      status: undefined,
      includeArchived: false,
      page: 1,
      limit: 20,
    });

    const prevButton = screen.getByRole('button', { name: /Anterior/i });
    const nextButton = screen.getByRole('button', { name: /Próxima/i });
    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    // Navega para a página 2
    fireEvent.click(nextButton);
    expect(await screen.findByText('Documento P2-1')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 20 })
    );
    expect(prevButton).not.toBeDisabled();
    expect(nextButton).toBeDisabled();

    // Volta para a página 1
    fireEvent.click(prevButton);
    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('volta para a página 1 ao alterar qualquer filtro (categoria, status, arquivados e busca)', async () => {
    const page1Docs = [makeDoc('doc-p1-1', 'Documento P1-1')];
    const page2Docs = [makeDoc('doc-p2-1', 'Documento P2-1')];

    const getDocuments = vi.spyOn(documentService, 'getDocuments').mockImplementation(async (params = {}) => {
      const p = params.page ?? 1;
      const lim = params.limit ?? 20;
      if (params.categoryId || params.status || params.search || params.includeArchived) {
        return {
          documents: [makeDoc('doc-filtered', 'Documento Filtrado')],
          total: 1,
          page: p,
          limit: lim,
        };
      }
      return {
        documents: p === 1 ? page1Docs : page2Docs,
        total: 25,
        page: p,
        limit: lim,
      };
    });

    renderWithRouterAndAuth(<DocumentsPage />);
    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();

    // Vai para a página 2 e altera categoria -> deve voltar para a página 1
    fireEvent.click(screen.getByRole('button', { name: /Próxima/i }));
    expect(await screen.findByText('Documento P2-1')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Todas as Categorias'), { target: { value: 'cat-1' } });
    expect(await screen.findByText('Documento Filtrado')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: 'cat-1', page: 1, limit: 20 })
    );

    // Limpa categoria, vai para a página 2 e altera status -> deve voltar para a página 1
    fireEvent.change(screen.getByDisplayValue(/Licenças/), { target: { value: '' } });
    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Próxima/i }));
    expect(await screen.findByText('Documento P2-1')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Todos os Status'), { target: { value: 'CRITICAL' } });
    expect(await screen.findByText('Documento Filtrado')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'CRITICAL', page: 1, limit: 20 })
    );

    // Limpa status, vai para a página 2 e altera arquivados -> deve voltar para a página 1
    fireEvent.change(screen.getByDisplayValue('Alerta Crítico'), { target: { value: '' } });
    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Próxima/i }));
    expect(await screen.findByText('Documento P2-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('Documento Filtrado')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeArchived: true, page: 1, limit: 20 })
    );

    // Desmarca arquivados, vai para a página 2 e altera busca textual -> deve voltar para a página 1
    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('Documento P1-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Próxima/i }));
    expect(await screen.findByText('Documento P2-1')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/buscar por título/i), { target: { value: 'Prefeitura' } });
    await waitFor(
      () =>
        expect(getDocuments).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'Prefeitura', page: 1, limit: 20 })
        ),
      { timeout: 1500 }
    );
  });
});

describe('Header e NotificationsPage — agregação de mais de 100 pendências', () => {
  it('percorre múltiplas páginas com limit=100 para exibir todas as pendências no Header e na NotificationsPage', async () => {
    const criticalAll = Array.from({ length: 120 }, (_, i) =>
      makeDoc(`crit-${i + 1}`, `Crítico ${i + 1}`, { status: 'CRITICAL' })
    );
    const expiredAll = Array.from({ length: 110 }, (_, i) =>
      makeDoc(`exp-${i + 1}`, `Vencido ${i + 1}`, { status: 'EXPIRED' })
    );

    const getDocuments = vi.spyOn(documentService, 'getDocuments').mockImplementation(async (params = {}) => {
      const source = params.status === 'CRITICAL' ? criticalAll : expiredAll;
      const p = params.page ?? 1;
      const lim = params.limit ?? 20;
      const start = (p - 1) * lim;
      return {
        documents: source.slice(start, start + lim),
        total: source.length,
        page: p,
        limit: lim,
      };
    });

    const { unmount } = renderWithRouterAndAuth(<Header />);

    const pendingButton = await screen.findByRole('button', { name: /Alertas e Pendências/i });
    await waitFor(() => expect(within(pendingButton).getByText('9+')).toBeInTheDocument());

    fireEvent.click(pendingButton);
    expect(await screen.findByText('230 pendência(s)')).toBeInTheDocument();
    expect(getDocuments).toHaveBeenCalledWith({ status: 'CRITICAL', page: 1, limit: 100 });
    expect(getDocuments).toHaveBeenCalledWith({ status: 'CRITICAL', page: 2, limit: 100 });
    expect(getDocuments).toHaveBeenCalledWith({ status: 'EXPIRED', page: 1, limit: 100 });
    expect(getDocuments).toHaveBeenCalledWith({ status: 'EXPIRED', page: 2, limit: 100 });

    unmount();

    renderWithRouterAndAuth(<NotificationsPage />);

    expect(await screen.findByText('230 documento(s) com atenção requerida')).toBeInTheDocument();
    expect(screen.getByText('Vencido 110')).toBeInTheDocument();
    expect(screen.getByText('Crítico 120')).toBeInTheDocument();
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
