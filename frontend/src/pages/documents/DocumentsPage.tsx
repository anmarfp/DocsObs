import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, AlertTriangle, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Document, DocumentCategory, DocumentStatus } from '@/features/documents/types/document.types';
import { documentService } from '@/features/documents/services/documentService';
import { categoryService } from '@/features/documents/services/categoryService';
import { DocumentFilters } from '@/features/documents/components/DocumentFilters';
import { DocumentTable } from '@/features/documents/components/DocumentTable';
import { DocumentFormModal } from '@/features/documents/components/DocumentFormModal';
import { DocumentRenewModal } from '@/features/documents/components/DocumentRenewModal';
import { DeleteConfirmModal } from '@/features/documents/components/DeleteConfirmModal';
import { ToastContainer } from '@/features/documents/components/Toast';
import { useToast } from '@/features/documents/hooks/useToast';
import { ReportExportModal } from '@/features/reports/components/ReportExportModal';

export const DocumentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();

  const { toasts, removeToast, toastSuccess, toastError } = useToast();

  // State: Data
  const [documents, setDocuments] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // State: Filters
  const [search, setSearch] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
  }, []);

  const handleCategoryChange = useCallback((val: string) => {
    setCategoryId(val);
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((val: DocumentStatus | '') => {
    setStatus(val);
    setPage(1);
  }, []);

  const handleIncludeArchivedChange = useCallback((val: boolean) => {
    setIncludeArchived(val);
    setPage(1);
  }, []);

  // State: Modals
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [documentToEdit, setDocumentToEdit] = useState<Document | null>(null);
  const [documentToRenew, setDocumentToRenew] = useState<Document | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);

  // Fetch Categories
  const fetchCategories = useCallback(async () => {
    try {
      const data = await categoryService.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Erro ao carregar categorias:', err);
    }
  }, []);

  // Fetch Documents
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await documentService.getDocuments({
        search: search.trim() || undefined,
        categoryId: categoryId || undefined,
        status: status || undefined,
        includeArchived: isAdmin ? includeArchived : false,
        page,
        limit,
      });

      setDocuments(data.documents || []);
      setTotalCount(data.total || 0);
    } catch (err) {
      console.error('Erro ao carregar documentos:', err);
      setLoadError('Não foi possível carregar a lista de documentos. Tente novamente.');
      toastError('Erro na Listagem', 'Falha ao buscar os documentos do servidor.');
    } finally {
      setIsLoading(false);
    }
  }, [search, categoryId, status, includeArchived, page, limit, isAdmin, toastError]);

  // Initial loads and re-fetch when filters change
  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Handlers for modal actions
  const handleOpenCreate = () => {
    setDocumentToEdit(null);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (doc: Document) => {
    setDocumentToEdit(doc);
    setIsCreateOpen(true);
  };

  const handleOpenRenew = (doc: Document) => {
    setDocumentToRenew(doc);
  };

  const handleOpenView = (doc: Document) => {
    navigate(`/documentos/${doc.id}`);
  };

  const handleOpenDelete = (doc: Document) => {
    setDocumentToDelete(doc);
  };

  // Toggle Archive
  const handleToggleArchive = async (doc: Document) => {
    try {
      const res = await documentService.toggleArchive(doc.id);
      toastSuccess(
        doc.isArchived ? 'Documento desarquivado' : 'Documento arquivado',
        res.message
      );
      fetchDocuments();
    } catch (err) {
      console.error('Erro ao alternar arquivamento:', err);
      toastError(
        'Falha na Ação',
        'Não foi possível alterar o estado de arquivamento do documento.'
      );
    }
  };

  // Authenticated Attachment Download
  const handleDownloadAttachment = async (url: string, filename: string) => {
    try {
      await documentService.downloadAttachment(url, filename);
    } catch (err) {
      console.error('Erro ao baixar anexo:', err);
      toastError('Erro no Download', 'Não foi possível baixar o anexo do documento.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div className="space-y-6">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-950 tracking-tight">Documentos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Listagem completa, filtros por categoria, status e gestão de renovações.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={() => {
              fetchDocuments();
              fetchCategories();
            }}
            disabled={isLoading}
            className="btn-secondary"
            title="Atualizar listagem"
          >
            <RefreshCw className={`w-4 h-4 mr-2 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="btn-secondary"
          >
            <Download className="w-4 h-4 mr-2 text-slate-500" />
            Exportar Relatório
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Documento
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <DocumentFilters
        search={search}
        onSearchChange={handleSearchChange}
        categoryId={categoryId}
        onCategoryChange={handleCategoryChange}
        status={status}
        onStatusChange={handleStatusChange}
        includeArchived={includeArchived}
        onIncludeArchivedChange={handleIncludeArchivedChange}
        categories={categories}
        isAdmin={isAdmin}
        totalCount={totalCount}
      />

      {/* Load error message if any */}
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-800">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={fetchDocuments}
            className="font-bold underline hover:text-red-950 ml-2"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Document Table */}
      <DocumentTable
        documents={documents}
        isLoading={isLoading}
        isAdmin={isAdmin}
        onView={handleOpenView}
        onEdit={handleOpenEdit}
        onRenew={handleOpenRenew}
        onToggleArchive={handleToggleArchive}
        onDelete={handleOpenDelete}
        onDownloadAttachment={handleDownloadAttachment}
      />

      {/* Server-Side Pagination Bar */}
      {totalCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card px-6 py-4 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            Página <strong>{page}</strong> de <strong>{totalPages}</strong> ({totalCount} documento(s))
          </span>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Document Modal */}
      <DocumentFormModal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          setDocumentToEdit(null);
        }}
        onSuccess={(msg) => {
          toastSuccess('Sucesso', msg);
          fetchDocuments();
          fetchCategories();
        }}
        onError={toastError}
        categories={categories}
        documentToEdit={documentToEdit}
      />

      {/* Renew Document Modal */}
      <DocumentRenewModal
        isOpen={!!documentToRenew}
        onClose={() => setDocumentToRenew(null)}
        onSuccess={(msg) => {
          toastSuccess('Renovação Concluída', msg);
          fetchDocuments();
        }}
        onError={toastError}
        document={documentToRenew}
      />

      {/* Admin Delete Confirm Modal */}
      <DeleteConfirmModal
        isOpen={!!documentToDelete}
        document={documentToDelete}
        onClose={() => setDocumentToDelete(null)}
        onSuccess={(msg) => {
          toastSuccess('Documento Excluído', msg);
          fetchDocuments();
          fetchCategories();
        }}
        onError={toastError}
      />

      {/* Report Export Modal */}
      <ReportExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onError={toastError}
        onSuccess={toastSuccess}
      />
    </div>
  );
};

export default DocumentsPage;
