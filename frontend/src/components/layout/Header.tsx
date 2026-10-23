import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Bell,
  User as UserIcon,
  LogOut,
  ChevronDown,
  AlertTriangle,
  Clock,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { documentService } from '@/features/documents/services/documentService';
import { Document } from '@/features/documents/types/document.types';
import { formatDate } from '@/features/documents/utils/dateHelper';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Real-time pending items (CRITICAL & EXPIRED)
  const [criticalDocs, setCriticalDocs] = useState<Document[]>([]);
  const [expiredDocs, setExpiredDocs] = useState<Document[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState<boolean>(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Fetch pending critical and expired documents
  const fetchPendingDocs = useCallback(async () => {
    if (!user) return;
    setIsLoadingPending(true);
    try {
      const [criticalRes, expiredRes] = await Promise.all([
        documentService.getAllDocuments({ status: 'CRITICAL' }),
        documentService.getAllDocuments({ status: 'EXPIRED' }),
      ]);
      setCriticalDocs(criticalRes.documents || []);
      setExpiredDocs(expiredRes.documents || []);
    } catch (err) {
      console.warn('Falha ao carregar pendências para o header:', err);
    } finally {
      setIsLoadingPending(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPendingDocs();
  }, [fetchPendingDocs]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getInitials = (name?: string) => {
    if (!name) return 'DO';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const isRoleAdmin = user?.role === 'ADMIN';
  const totalPending = criticalDocs.length + expiredDocs.length;
  const pendingSample = [...expiredDocs, ...criticalDocs].slice(0, 6);

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-40 px-4 md:px-6 flex items-center justify-between shadow-sm">
      {/* Left: Brand */}
      <div className="flex items-center space-x-3">
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-9 h-9 rounded-xl bg-navy-950 flex items-center justify-center shadow text-navy-100 font-bold text-base transition-transform group-hover:scale-105">
            DO
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-base font-bold text-navy-950 leading-tight tracking-tight">DocsObs</span>
            <span className="text-[11px] text-slate-400 font-medium leading-none">Gestão de Vencimentos</span>
          </div>
        </Link>
      </div>

      {/* Right: Notifications & User Profile */}
      <div className="flex items-center space-x-3">
        {/* Pending Alerts Popover */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setNotificationsOpen((prev) => !prev);
              setProfileDropdownOpen(false);
              if (!notificationsOpen) {
                fetchPendingDocs();
              }
            }}
            aria-label="Alertas e Pendências"
            className="p-2 rounded-lg text-slate-600 hover:text-navy-900 hover:bg-slate-100 relative transition"
          >
            <Bell className="w-5 h-5" />
            {totalPending > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white animate-pulse">
                {totalPending > 9 ? '9+' : totalPending}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Pendências Ativas</span>
                  {isLoadingPending && <RefreshCw className="w-3 h-3 animate-spin text-navy-600" />}
                </div>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    totalPending > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {totalPending} pendência(s)
                </span>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {totalPending === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    <FileText className="w-8 h-8 text-emerald-500 mx-auto mb-1 opacity-70" />
                    <p className="font-semibold text-slate-700">Nenhum documento vencido ou crítico</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Todos os prazos estão em conformidade.</p>
                  </div>
                ) : (
                  pendingSample.map((doc) => {
                    const isExpired = doc.status === 'EXPIRED';

                    return (
                      <Link
                        key={doc.id}
                        to="/documentos"
                        onClick={() => setNotificationsOpen(false)}
                        className="p-3 flex items-start space-x-3 hover:bg-slate-50 transition"
                      >
                        <div
                          className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
                            isExpired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                          }`}
                        >
                          {isExpired ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0 text-xs">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-slate-800 truncate">{doc.title}</p>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded ml-1 ${
                                isExpired ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {isExpired ? 'Vencido' : 'Crítico'}
                            </span>
                          </div>
                          <p className="text-slate-500 text-[11px] mt-0.5 truncate">
                            {doc.category?.name || 'Documento'} &bull; Vencimento: {formatDate(doc.expirationDate)}
                          </p>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>

              <div className="p-2 border-t border-slate-100 text-center">
                <Link
                  to="/documentos"
                  onClick={() => setNotificationsOpen(false)}
                  className="text-xs font-semibold text-navy-700 hover:text-navy-900 block py-1"
                >
                  Abrir Módulo de Documentos &rarr;
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => {
              setProfileDropdownOpen((prev) => !prev);
              setNotificationsOpen(false);
            }}
            className="flex items-center space-x-2.5 p-1.5 rounded-xl hover:bg-slate-100 transition focus:outline-none focus:ring-2 focus:ring-navy-600"
          >
            <div className="w-8 h-8 rounded-lg bg-navy-900 text-navy-100 flex items-center justify-center text-xs font-bold shadow-sm">
              {getInitials(user?.name)}
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-800 leading-none">{user?.name || 'Usuário'}</span>
              <span className="text-[10px] font-bold tracking-wider text-navy-600 mt-0.5 uppercase">
                {isRoleAdmin ? 'ADMINISTRADOR' : 'OPERACIONAL'}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" />
          </button>

          {profileDropdownOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900 leading-tight">{user?.name}</p>
                <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
                <div className="mt-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isRoleAdmin ? 'bg-navy-100 text-navy-900' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {isRoleAdmin ? 'Perfil: Administrador' : 'Perfil: Operacional'}
                  </span>
                </div>
              </div>

              <div className="py-1">
                <Link
                  to="/perfil"
                  onClick={() => setProfileDropdownOpen(false)}
                  className="flex items-center px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-navy-900"
                >
                  <UserIcon className="w-4 h-4 mr-2.5 text-slate-400" />
                  Meu Perfil
                </Link>
              </div>

              <div className="border-t border-slate-100 pt-1">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition text-left"
                >
                  <LogOut className="w-4 h-4 mr-2.5 text-red-500" />
                  Sair do Sistema
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
