import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  AlertTriangle,
  Clock,
  RefreshCw,
  FileText,
  CheckCircle2,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { documentService } from '@/features/documents/services/documentService';
import { Document } from '@/features/documents/types/document.types';
import { formatDate } from '@/features/documents/utils/dateHelper';
import DocumentStatusBadge from '@/features/documents/components/DocumentStatusBadge';
import { ToastContainer } from '@/features/documents/components/Toast';
import { useToast } from '@/features/documents/hooks/useToast';

export const NotificationsPage: React.FC = () => {
  const { toasts, removeToast, toastError } = useToast();

  const [criticalDocs, setCriticalDocs] = useState<Document[]>([]);
  const [expiredDocs, setExpiredDocs] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchPending = useCallback(async () => {
    setIsLoading(true);
    try {
      const [criticalRes, expiredRes] = await Promise.all([
        documentService.getAllDocuments({ status: 'CRITICAL' }),
        documentService.getAllDocuments({ status: 'EXPIRED' }),
      ]);
      setCriticalDocs(criticalRes.documents || []);
      setExpiredDocs(expiredRes.documents || []);
    } catch (err: any) {
      console.error('Falha ao buscar pendências:', err);
      toastError('Erro ao Carregar', 'Não foi possível carregar as pendências ativas.');
    } finally {
      setIsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const allPending = [...expiredDocs, ...criticalDocs];

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-950 tracking-tight">Central de Pendências & Alertas</h1>
          <p className="text-sm text-slate-500 mt-1">
            Acompanhe os documentos vencidos e com vencimento crítico iminente que necessitam de providências.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={fetchPending}
            disabled={isLoading}
            className="btn-secondary"
            title="Atualizar pendências"
          >
            <RefreshCw className={`w-4 h-4 mr-2 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <Link to="/documentos" className="btn-primary">
            <FileText className="w-4 h-4 mr-2" />
            Gerenciar Documentos
          </Link>
        </div>
      </div>

      {/* Highlights Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-card flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Total de Pendências
            </span>
            <div className="text-3xl font-black text-navy-950 mt-1">
              {isLoading ? (
                <div className="h-8 w-12 bg-slate-200 animate-pulse rounded" />
              ) : (
                allPending.length
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">Requerem atenção ou renovação</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-navy-50 text-navy-700 flex items-center justify-center">
            <Bell className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-red-200 bg-red-50/30 shadow-card flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-red-600 uppercase tracking-wider block">
              Documentos Vencidos
            </span>
            <div className="text-3xl font-black text-red-600 mt-1">
              {isLoading ? (
                <div className="h-8 w-12 bg-slate-200 animate-pulse rounded" />
              ) : (
                expiredDocs.length
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">Prazo legal ultrapassado</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-700 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-amber-200 bg-amber-50/30 shadow-card flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider block">
              Alerta Crítico
            </span>
            <div className="text-3xl font-black text-amber-600 mt-1">
              {isLoading ? (
                <div className="h-8 w-12 bg-slate-200 animate-pulse rounded" />
              ) : (
                criticalDocs.length
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">Dentro da faixa de alerta</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* List of Pending Documents */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-950 uppercase tracking-wider">
            Lista de Documentos Pendentes
          </h2>
          <span className="text-xs text-slate-500">
            {allPending.length} documento(s) com atenção requerida
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-navy-600" />
            <p className="text-xs">Buscando pendências...</p>
          </div>
        ) : allPending.length === 0 ? (
          <div className="p-12 text-center bg-slate-50">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2 opacity-80" />
            <h3 className="text-base font-bold text-navy-950">Nenhuma pendência encontrada!</h3>
            <p className="text-xs text-slate-500 mt-1">
              Todos os documentos cadastrados estão em situação regular ou dentro do prazo previsto.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {allPending.map((doc) => {
              const isExpired = doc.status === 'EXPIRED';

              return (
                <div
                  key={doc.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-slate-50/60 transition"
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl mt-0.5 flex-shrink-0 ${
                        isExpired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {isExpired ? (
                        <AlertTriangle className="w-5 h-5" />
                      ) : (
                        <Clock className="w-5 h-5" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{doc.title}</h3>
                        <DocumentStatusBadge status={doc.status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {doc.category?.name || 'Sem Categoria'} &bull; Órgão: {doc.issuingBody || 'Não informado'}
                      </p>
                      {doc.responsibleName && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Responsável: {doc.responsibleName} ({doc.responsibleEmail || 'sem e-mail'})
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 flex-shrink-0 self-end sm:self-center">
                    <div className="text-right text-xs">
                      <span className="text-slate-400 block text-[10px]">Data de Vencimento</span>
                      <span className="font-bold text-slate-800 flex items-center">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        {formatDate(doc.expirationDate)}
                      </span>
                    </div>

                    <Link
                      to="/documentos"
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Acessar Documento
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
