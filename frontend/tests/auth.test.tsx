import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import NotFoundPage from '@/pages/NotFoundPage';
import DocumentDetailPage from '@/pages/documents/DocumentDetailPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import { documentService } from '@/features/documents/services/documentService';
import { categoryService } from '@/features/documents/services/categoryService';
import { companyService } from '@/features/documents/services/companyService';
import { googleAuthService } from '@/features/calendar/services/googleAuthService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as AuthModule from '@/contexts/AuthContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import LoginPage from '@/pages/auth/LoginPage';
import { authService, TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from '@/services/api';
import type { AuthContextType, User } from '@/types/auth';

const admin: User = { id: '1', name: 'Ana', email: 'ana@docsobs.com', role: 'ADMIN', isActive: true };

function Probe() {
  const auth = useAuth();
  return <div>{`${auth.isLoading}:${auth.isAuthenticated}:${auth.user?.email ?? 'none'}`}</div>;
}

function value(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: admin,
    token: 'jwt',
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('LoginPage - preenchimento rapido (DOC-32)', () => {
  function renderLogin() {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue(
      value({ user: null, token: null, isAuthenticated: false })
    );
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    );
  }

  it('nao renderiza os botoes fora do modo de desenvolvimento', () => {
    vi.stubEnv('DEV', false);
    renderLogin();
    expect(screen.queryByText(/preenchimento r[aá]pido/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /administrador/i })).not.toBeInTheDocument();
  });

  it('em desenvolvimento preenche somente o e-mail, sem senha', () => {
    vi.stubEnv('DEV', true);
    renderLogin();
    screen.getByRole('button', { name: /administrador/i }).click();
    return waitFor(() => {
      expect(screen.getByLabelText(/e-mail corporativo/i)).toHaveValue('admin@docsobs.com.br');
      expect(screen.getByLabelText(/senha de acesso/i)).toHaveValue('');
    });
  });
});

describe('AuthContext e RBAC', () => {
  it('restaura usuario/token persistidos apos validar /auth/me', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt');
    vi.spyOn(authService, 'getMe').mockResolvedValue({ user: admin });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(`false:true:${admin.email}`)).toBeInTheDocument());
    expect(localStorage.getItem(USER_STORAGE_KEY)).toContain(admin.email);
  });

  it('persiste as credenciais retornadas no login', async () => {
    vi.spyOn(authService, 'getMe').mockResolvedValue({ user: admin });
    vi.spyOn(authService, 'login').mockResolvedValue({ token: 'new-jwt', user: admin });
    function Login() {
      const auth = useAuth();
      return <button onClick={() => void auth.login({ email: admin.email, password: 'secret' })}>login</button>;
    }
    render(<AuthProvider><Login /></AuthProvider>);
    screen.getByRole('button').click();
    await waitFor(() => expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('new-jwt'));
  });

  it('redireciona visitante e bloqueia role nao autorizada', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue(
      value({ user: null, token: null, isAuthenticated: false })
    );
    render(
      <MemoryRouter initialEntries={['/private']}>
        <Routes>
          <Route path="/login" element={<div>login</div>} />
          <Route path="/private" element={<ProtectedRoute>privado</ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('login')).toBeInTheDocument();

    vi.mocked(AuthModule.useAuth).mockReturnValue(
      value({ user: { ...admin, role: 'OPERATIONAL' } })
    );
    render(
      <MemoryRouter>
        <ProtectedRoute allowedRoles={['ADMIN']}>privado</ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();

    for (const adminPath of ['/usuarios', '/auditoria', '/configuracoes']) {
      cleanup();
      render(
        <MemoryRouter initialEntries={[adminPath]}>
          <Routes>
            <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
              <Route path="usuarios" element={<div>usuarios</div>} />
              <Route path="auditoria" element={<div>auditoria</div>} />
              <Route path="configuracoes" element={<div>configuracoes</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByText(/acesso restrito/i)).toBeInTheDocument();
    }
  });

  it('exibe NotFoundPage em rota desconhecida, abre /documentos/:id, preserva useSearchParams e estado ativo de NavLink', async () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue(value());

    // 1. Unknown path -> NotFoundPage
    render(
      <MemoryRouter initialEntries={['/rota-inexistente']}>
        <Routes>
          <Route path="/" element={<div>inicio</div>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/P[aá]gina N[aã]o Encontrada \(404\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Voltar ao In[ií]cio/i }));
    expect(await screen.findByText('inicio')).toBeInTheDocument();
    cleanup();

    // 2. /documentos/:id via Link / rota parametrizada -> DocumentDetailPage
    const getDocById = vi.spyOn(documentService, 'getDocumentById').mockResolvedValue({
      id: 'doc-42',
      title: 'Licença Operacional 42',
      categoryId: 'cat-1',
      category: { id: 'cat-1', name: 'Licenças', colorHex: '#5483B3', description: null },
      issuingBody: 'IBAMA',
      issueDate: '2026-01-01T00:00:00.000Z',
      expirationDate: '2026-12-31T00:00:00.000Z',
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
      createdById: '1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.spyOn(categoryService, 'getCategories').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/calendario']}>
        <Routes>
          <Route path="/calendario" element={<Link to="/documentos/doc-42">Abrir em Documentos</Link>} />
          <Route path="/documentos" element={<Link to="/documentos/doc-42">Ver detalhes na lista</Link>} />
          <Route path="/documentos/:id" element={<DocumentDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('link', { name: /Abrir em Documentos/i }));
    expect(await screen.findByText('Licença Operacional 42')).toBeInTheDocument();
    expect(getDocById).toHaveBeenCalledWith('doc-42');
    fireEvent.click(screen.getByRole('button', { name: /Voltar para Documentos/i }));
    fireEvent.click(await screen.findByRole('link', { name: /Ver detalhes na lista/i }));
    expect(await screen.findByText('Licença Operacional 42')).toBeInTheDocument();
    cleanup();

    // 3. useSearchParams leitura e escrita (SettingsPage ?google=connected&aba=geral)
    vi.spyOn(companyService, 'getConfig').mockResolvedValue({
      id: 'cfg-1',
      notificationMode: 'ALL_ADMINS',
      updatedAt: '2026-08-27T00:00:00.000Z',
      updatedById: '1',
    });
    vi.spyOn(googleAuthService, 'getStatus').mockResolvedValue({ connected: true });
    function SearchProbe() {
      const loc = useLocation();
      return <div data-testid="location-search">{loc.search}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/configuracoes?google=connected&aba=geral']}>
        <Routes>
          <Route
            path="/configuracoes"
            element={
              <>
                <SettingsPage />
                <SearchProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/Google Agenda Conectado/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('?aba=geral'));
    cleanup();

    // 4. Sidebar NavLink estado ativo
    render(
      <MemoryRouter initialEntries={['/documentos']}>
        <Sidebar isOpen={true} onClose={vi.fn()} />
        <Routes>
          <Route path="/" element={<Outlet />}>
            <Route index element={<div>painel</div>} />
            <Route path="documentos" element={<div>lista</div>} />
            <Route path="calendario" element={<div>agenda</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const dashboardLink = screen.getByRole('link', { name: /Dashboard/i });
    const docsLink = screen.getByRole('link', { name: /Documentos/i });
    const calendarLink = screen.getByRole('link', { name: /Agenda & Google Sync/i });
    expect(docsLink).toHaveAttribute('aria-current', 'page');
    expect(docsLink.className).toContain('bg-navy-600');
    expect(dashboardLink).not.toHaveAttribute('aria-current');
    expect(dashboardLink.className).not.toContain('bg-navy-600');

    fireEvent.click(calendarLink);
    await waitFor(() => expect(calendarLink).toHaveAttribute('aria-current', 'page'));
    expect(calendarLink.className).toContain('bg-navy-600');
    expect(docsLink).not.toHaveAttribute('aria-current');
  });
});
