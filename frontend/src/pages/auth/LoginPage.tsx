import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Lock, Mail, Eye, EyeOff, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { AxiosError } from 'axios';

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already authenticated, redirect to home/intended route
  useEffect(() => {
    if (isAuthenticated) {
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Por favor, informe o e-mail e a senha.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch (err: unknown) {
      if (err instanceof AxiosError) {
        if (err.response?.data?.message) {
          setErrorMsg(err.response.data.message);
        } else if (err.response?.status === 401) {
          setErrorMsg('Credenciais inválidas ou usuário inativo.');
        } else if (err.code === 'ERR_NETWORK') {
          setErrorMsg('Não foi possível conectar ao servidor backend. Verifique se a API está online.');
        } else {
          setErrorMsg('Ocorreu um erro ao realizar o login. Tente novamente.');
        }
      } else {
        setErrorMsg('Erro inesperado durante a autenticação.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Somente em desenvolvimento: preenche apenas o e-mail do usuário do seed.
  // As senhas não são versionadas (DOC-32) — use a exibida pelo seed ou a das
  // variáveis *_SEED_PASSWORD.
  const fillDemoEmail = (role: 'admin' | 'operational') => {
    setEmail(role === 'admin' ? 'admin@docsobs.com.br' : 'operacional@docsobs.com.br');
    setPassword('');
    document.getElementById('password')?.focus();
  };

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-navy-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-navy-400/10 rounded-full blur-2xl pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-navy-900 border border-navy-400/40 shadow-glow text-navy-100 font-black text-2xl tracking-wider mb-2">
            DO
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">DocsObs</h1>
          <p className="text-sm text-navy-300">
            Gestão Proativa de Vencimento e Renovação de Documentos
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-navy-900/90 backdrop-blur-md rounded-2xl border border-navy-400/25 p-7 sm:p-8 shadow-2xl space-y-6">
          <div className="border-b border-navy-800 pb-4">
            <h2 className="text-lg font-bold text-white">Acesse sua conta</h2>
            <p className="text-xs text-navy-300 mt-1">Informe suas credenciais para gerenciar prazos e alertas.</p>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-start space-x-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-navy-200 uppercase tracking-wider">
                E-mail Corporativo
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-navy-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com.br"
                  className="block w-full pl-10 pr-3.5 py-2.5 bg-navy-950/80 border border-navy-700 rounded-xl text-white placeholder-navy-500 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-semibold text-navy-200 uppercase tracking-wider">
                  Senha de Acesso
                </label>
              </div>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-navy-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 bg-navy-950/80 border border-navy-700 rounded-xl text-white placeholder-navy-500 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-navy-400 hover:text-navy-200 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-navy-600 bg-navy-950 border-navy-700 rounded focus:ring-navy-600 focus:ring-offset-navy-900"
                />
                <span className="text-xs text-navy-300">Lembrar neste navegador</span>
              </label>

              <span className="text-xs text-navy-400 flex items-center">
                <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                Conexão Segura JWT
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-3 px-4 rounded-xl text-sm font-bold text-white bg-navy-600 hover:bg-navy-500 active:bg-navy-700 shadow-md hover:shadow-glow transition duration-150 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Autenticando...</span>
                </>
              ) : (
                <span>Entrar no Sistema</span>
              )}
            </button>
          </form>

          {/* Quick Demo Fill Buttons (somente no servidor de desenvolvimento) */}
          {import.meta.env.DEV && (
            <div className="pt-3 border-t border-navy-800/80">
              <p className="text-[11px] font-semibold text-navy-400 uppercase tracking-wider mb-2 text-center">
                Preenchimento Rápido (Ambiente de Desenvolvimento)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => fillDemoEmail('admin')}
                  className="px-2.5 py-2 text-xs font-medium text-navy-200 bg-navy-950/60 hover:bg-navy-950 border border-navy-800 rounded-lg text-center transition"
                >
                  👑 Administrador
                </button>
                <button
                  type="button"
                  onClick={() => fillDemoEmail('operational')}
                  className="px-2.5 py-2 text-xs font-medium text-navy-200 bg-navy-950/60 hover:bg-navy-950 border border-navy-800 rounded-lg text-center transition"
                >
                  💼 Operacional
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-navy-400">
          DocsObs &copy; {new Date().getFullYear()} — Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
