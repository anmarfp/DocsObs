import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/services/api';
import * as AuthModule from '@/contexts/AuthContext';
import type { AuthContextType, Role, User } from '@/types/auth';
import type { DashboardMetrics } from '@/features/dashboard/types/dashboard.types';
import type { Document } from '@/features/documents/types/document.types';
import { dashboardService } from '@/features/dashboard/services/dashboardService';
import { reportService } from '@/features/reports/services/reportService';
import { documentService } from '@/features/documents/services/documentService';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { Header } from '@/components/layout/Header';

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('recharts', async () => {
  const ReactModule = await import('react');
  const Stub = ({ children }: React.PropsWithChildren) =>
    ReactModule.createElement('div', { 'data-testid': 'chart-stub' }, children);
  return {
    ResponsiveContainer: Stub,
    PieChart: Stub,
    Pie: Stub,
    Cell: Stub,
    Tooltip: Stub,
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
  };
});

const apiGet = vi.mocked(api.get);

const admin: User = {
  id: 'admin-1',
  name: 'Ana Admin',
  email: 'ana@docsobs.test',
  role: 'ADMIN',
  isActive: true,
};

function authValue(role: Role = 'ADMIN'): AuthContextType {
  const user = { ...admin, role };
  return {
    user,
    token: 'jwt',
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  };
}

function renderWithAuth(node: React.ReactNode, role: Role = 'ADMIN') {
  vi.spyOn(AuthModule, 'useAuth').mockReturnValue(authValue(role));
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function makeDocument(overrides: Partial<Document>): Document {
  return {
    id: 'doc-1',
    title: 'Alvará Sanitário',
    categoryId: 'cat-1',
    category: {
      id: 'cat-1',
      name: 'Licenças',
      colorHex: '#5483B3',
      description: null,
    },
    issuingBody: null,
    issueDate: '2026-01-01',
    expirationDate: '2026-08-30T00:00:00.000Z',
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
    createdById: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const metrics: DashboardMetrics = {
  statusCounts: {
    EXPIRED: 2,
    CRITICAL: 3,
    RENEWAL_IN_PROGRESS: 4,
    REGULAR: 5,
    INDETERMINATE: 1,
  },
  totalActive: 15,
  totalArchived: 9,
  complianceRate: 73.4,
  byCategory: [
    { categoryId: 'cat-1', categoryName: 'Licenças', colorHex: '#5483B3', count: 3 },
  ],
  upcomingExpirations: [makeDocument({})],
};

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Dashboard — métricas e RBAC', () => {
  it('usa GET /dashboard/metrics e renderiza métricas, compliance e o recorte de 30 dias', async () => {
    apiGet.mockResolvedValueOnce({ data: metrics });
    await expect(dashboardService.getMetrics()).resolves.toEqual(metrics);
    expect(apiGet).toHaveBeenCalledWith('/dashboard/metrics');
    expect(apiGet.mock.calls[0][0]).not.toContain('/api/v1');

    vi.spyOn(dashboardService, 'getMetrics').mockResolvedValue(metrics);
    renderWithAuth(<DashboardPage />);

    const activeLabel = await screen.findByText(/^Documentos Ativos$/i);
    expect(activeLabel.parentElement).toHaveTextContent('15');
    expect(screen.getByText(/Taxa de Conformidade/i).parentElement).toHaveTextContent('73.4%');
    expect(screen.getByText(/Documentos Arquivados/i).parentElement).toHaveTextContent('9');
    expect(screen.getByText(/Próximos Vencimentos por Categoria \(30 dias\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Contabiliza apenas documentos.*próximos 30 dias/i)).toBeInTheDocument();
    expect(screen.getByText('Alvará Sanitário')).toBeInTheDocument();
  });

  it('não expõe totalArchived ao perfil OPERATIONAL', async () => {
    vi.spyOn(dashboardService, 'getMetrics').mockResolvedValue(metrics);
    renderWithAuth(<DashboardPage />, 'OPERATIONAL');

    await screen.findByText(/^Documentos Ativos$/i);
    expect(screen.queryByText(/Documentos Arquivados/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Status Operacional/i)).toBeInTheDocument();
  });

  it('mostra erro recuperável e tenta GET novamente', async () => {
    const getMetrics = vi
      .spyOn(dashboardService, 'getMetrics')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(metrics);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithAuth(<DashboardPage />);

    const retry = await screen.findByRole('button', { name: /Tentar novamente/i });
    fireEvent.click(retry);
    await waitFor(() => expect(getMetrics).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Alvará Sanitário')).toBeInTheDocument();
  });
});

describe('Relatórios — contratos e download CSV', () => {
  it('envia filtros reais para summary/json sem duplicar /api/v1', async () => {
    const summary = {
      totalDocuments: 12,
      complianceRate: 80,
      statusCounts: metrics.statusCounts,
    };
    apiGet
      .mockResolvedValueOnce({ data: summary })
      .mockResolvedValueOnce({ data: { documents: [], total: 0 } });

    await expect(
      reportService.getSummary({ status: 'CRITICAL', categoryId: 'cat-1', includeArchived: true })
    ).resolves.toEqual(summary);
    await reportService.exportJson({ startDate: '2026-08-01', endDate: '2026-08-31' });

    expect(apiGet).toHaveBeenNthCalledWith(1, '/reports/summary', {
      params: { status: 'CRITICAL', categoryId: 'cat-1', includeArchived: true },
    });
    expect(apiGet).toHaveBeenNthCalledWith(2, '/reports/export', {
      params: { format: 'json', startDate: '2026-08-01', endDate: '2026-08-31' },
    });
    expect(apiGet.mock.calls.flat().join(' ')).not.toContain('/api/v1/api/v1');
  });

  it('baixa CSV como blob, extrai filename e sempre revoga a URL temporária', async () => {
    apiGet.mockResolvedValueOnce({
      data: 'Título,Status\nAlvará,CRITICAL',
      headers: { 'content-disposition': 'attachment; filename="relatorio-fase3.csv"' },
    });
    const createObjectURL = vi.fn(() => 'blob:phase3');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clickedDownload = this.download;
    });

    await reportService.exportCsv({ status: 'EXPIRED', includeArchived: true });

    expect(apiGet).toHaveBeenCalledWith('/reports/export', {
      params: { format: 'csv', status: 'EXPIRED', includeArchived: true },
      responseType: 'blob',
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedDownload).toBe('relatorio-fase3.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:phase3');
    expect(document.querySelector('a[download="relatorio-fase3.csv"]')).not.toBeInTheDocument();
  });

  it('decodifica erro JSON encapsulado em Blob', async () => {
    const errorBlob = new Blob([JSON.stringify({ message: 'Exportação indisponível' })], {
      type: 'application/json',
    });
    Object.defineProperty(errorBlob, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Exportação indisponível' })),
    });
    apiGet.mockRejectedValueOnce({ response: { data: errorBlob } });

    await expect(reportService.exportCsv()).rejects.toThrow('Exportação indisponível');
  });
});

describe('Header — pendências dinâmicas', () => {
  it('deriva contagem e listagem de documentos CRITICAL e EXPIRED', async () => {
    const critical = makeDocument({ id: 'critical-1', title: 'Licença Crítica', status: 'CRITICAL' });
    const expired = makeDocument({ id: 'expired-1', title: 'Contrato Vencido', status: 'EXPIRED' });
    const getDocuments = vi
      .spyOn(documentService, 'getDocuments')
      .mockImplementation(async ({ status } = {}) => ({
        documents: status === 'CRITICAL' ? [critical] : [expired],
        total: 1,
        page: 1,
        limit: 100,
      }));

    renderWithAuth(<Header />);

    await waitFor(() => {
      expect(getDocuments).toHaveBeenCalledWith({ status: 'CRITICAL', page: 1, limit: 100 });
      expect(getDocuments).toHaveBeenCalledWith({ status: 'EXPIRED', page: 1, limit: 100 });
    });
    const pendingButton = screen.getByRole('button', { name: /Alertas e Pendências/i });
    expect(within(pendingButton).getByText('2')).toBeInTheDocument();

    fireEvent.click(pendingButton);
    expect(await screen.findByText('Licença Crítica')).toBeInTheDocument();
    expect(screen.getByText('Contrato Vencido')).toBeInTheDocument();
    expect(screen.getByText(/2 pendência\(s\)/i)).toBeInTheDocument();
  });
});
