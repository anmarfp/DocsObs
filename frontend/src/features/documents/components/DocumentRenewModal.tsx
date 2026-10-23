import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, Loader2, RefreshCw, History } from 'lucide-react';
import { AxiosError } from 'axios';
import { Document } from '../types/document.types';
import { documentService } from '../services/documentService';
import { renewFormSchema, RenewFormValues } from '../utils/documentValidation';
import { buildRenewFormData } from '../utils/formDataHelper';
import { formatDate, toLocalInputDateFormat } from '../utils/dateHelper';
import FileDropzone from './FileDropzone';

interface DocumentRenewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (title: string, message?: string) => void;
  document: Document | null;
}

export const DocumentRenewModal: React.FC<DocumentRenewModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError,
  document,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RenewFormValues>({
    resolver: zodResolver(renewFormSchema),
    defaultValues: {
      issueDate: '',
      expirationDate: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (isOpen && document) {
      setSelectedFile(null);
      setUploadProgress(null);
      reset({
        issueDate: toLocalInputDateFormat(new Date()),
        expirationDate: '',
        notes: '',
      });
    }
  }, [isOpen, document, reset]);

  if (!isOpen || !document) return null;

  const onSubmit = async (values: RenewFormValues) => {
    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      const formData = buildRenewFormData({
        issueDate: values.issueDate,
        expirationDate: values.expirationDate,
        notes: values.notes,
        attachment: selectedFile,
      });

      const res = await documentService.renewDocument(document.id, formData, (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        }
      });

      onSuccess(res.message || 'Documento renovado com sucesso.');
      onClose();
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      onError(
        'Falha na Renovação',
        axiosError.response?.data?.message || 'Ocorreu um erro ao processar a renovação do documento.'
      );
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="renew-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-navy-100 text-navy-800 flex items-center justify-center">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <h2 id="renew-modal-title" className="text-lg font-bold text-navy-950">
                Renovar Documento
              </h2>
              <p className="text-xs text-slate-500">
                Gera uma nova versão vigente e arquiva a versão anterior no histórico.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Current Document Summary Banner */}
          <div className="p-4 bg-navy-50/50 border border-navy-200/70 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-navy-900">Documento Atual</span>
              <span className="text-[11px] text-slate-500">{document.category?.name}</span>
            </div>
            <p className="text-sm font-semibold text-slate-800 truncate">{document.title}</p>
            <div className="flex items-center space-x-4 text-xs text-slate-600">
              <span>Emissão atual: <strong>{formatDate(document.issueDate)}</strong></span>
              <span>Vencimento atual: <strong>{formatDate(document.expirationDate)}</strong></span>
            </div>
          </div>

          <div className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl flex items-start space-x-2 text-xs text-amber-900">
            <History className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <span>
              Ao renovar, os dados e anexo atuais serão salvos permanentemente como <strong>Versão Histórica</strong> e as novas datas entrarão em vigor imediatamente.
            </span>
          </div>

          <form id="renew-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
            {/* New Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="renew-issueDate" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nova Data de Emissão <span className="text-red-500">*</span>
                </label>
                <input
                  id="renew-issueDate"
                  type="date"
                  disabled={isSubmitting}
                  {...register('issueDate')}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    errors.issueDate ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                  }`}
                />
                {errors.issueDate && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.issueDate.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="renew-expirationDate" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nova Data de Vencimento
                </label>
                <input
                  id="renew-expirationDate"
                  type="date"
                  disabled={isSubmitting}
                  {...register('expirationDate')}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    errors.expirationDate ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                  }`}
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Em branco = Sem vencimento</span>
                {errors.expirationDate && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.expirationDate.message}</p>
                )}
              </div>
            </div>

            {/* Renewal Notes */}
            <div>
              <label htmlFor="renew-notes" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Observações do Novo Ciclo
              </label>
              <textarea
                id="renew-notes"
                rows={2}
                placeholder="Ex: Renovação referente ao protocolo 2026/0998..."
                disabled={isSubmitting}
                {...register('notes')}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition"
              />
            </div>

            {/* New Attachment */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Novo Anexo (Opcional)
              </label>
              <FileDropzone
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
                uploadProgress={uploadProgress}
                disabled={isSubmitting}
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="renew-form"
            disabled={isSubmitting}
            className="btn-primary min-w-[140px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Renovando...
              </>
            ) : (
              'Confirmar Renovação'
            )}
          </button>
        </div>
      </div>
    </div>,
    window.document.body
  );
};

export default DocumentRenewModal;
