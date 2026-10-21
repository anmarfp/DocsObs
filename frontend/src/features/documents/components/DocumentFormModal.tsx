import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, Loader2, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { AxiosError } from 'axios';
import {
  Document,
  DocumentCategory,
  CompanyConfig,
  NotificationMode,
  DEFAULT_CATEGORY_NAME,
} from '../types/document.types';
import { documentService, ExtractionResponse } from '../services/documentService';
import { companyService } from '../services/companyService';
import {
  createDocumentFormSchema,
  DocumentFormValues,
} from '../utils/documentValidation';
import { buildCreateFormData, buildUpdateFormData, DocumentFormData } from '../utils/formDataHelper';
import { toInputDateFormat } from '../utils/dateHelper';
import FileDropzone from './FileDropzone';

interface DocumentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (title: string, message?: string) => void;
  categories: DocumentCategory[];
  documentToEdit?: Document | null;
}

export const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError,
  categories,
  documentToEdit,
}) => {
  const isEdit = !!documentToEdit;
  const [config, setConfig] = useState<CompanyConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionSuggestions, setExtractionSuggestions] = useState<ExtractionResponse | null>(null);
  const [suggestedFields, setSuggestedFields] = useState<{
    issueDate?: number;
    expirationDate?: number;
    issuingBody?: number;
  }>({});
  const [isExtractionConfirmed, setIsExtractionConfirmed] = useState<boolean>(false);
  const [extractionErrorMsg, setExtractionErrorMsg] = useState<string | null>(null);

  const notificationMode: NotificationMode = config?.notificationMode || 'ALL_ADMINS';

  const schema = useMemo(() => {
    return createDocumentFormSchema(notificationMode);
  }, [notificationMode]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<DocumentFormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      title: '',
      categoryId: '',
      issuingBody: '',
      issueDate: '',
      expirationDate: '',
      alertLeadDays: 30,
      responsibleName: '',
      responsibleEmail: '',
      notes: '',
      isRenewalInProgress: false,
    },
  });

  // Load company configuration on open
  const loadConfig = async () => {
    setIsLoadingConfig(true);
    setConfigError(null);
    try {
      const companyConfig = await companyService.getConfig();
      setConfig(companyConfig);
    } catch (err) {
      console.error('Falha ao carregar configurações da empresa:', err);
      setConfigError('Não foi possível carregar as configurações do sistema. Tente novamente.');
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const handleFileSelect = (file: File | null) => {
    setSelectedFile(file);
    setExtractionSuggestions(null);
    setSuggestedFields({});
    setIsExtractionConfirmed(false);
    setExtractionErrorMsg(null);
  };

  const handleSuggestFields = async () => {
    if (!selectedFile) return;
    setIsExtracting(true);
    setExtractionErrorMsg(null);
    try {
      const res = await documentService.extractFields(selectedFile);
      setExtractionSuggestions(res);

      const newSuggestedFields: { issueDate?: number; expirationDate?: number; issuingBody?: number } = {};

      if (res.fields.issueDate?.value) {
        setValue('issueDate', toInputDateFormat(res.fields.issueDate.value), { shouldValidate: true });
        newSuggestedFields.issueDate = Math.round(res.fields.issueDate.confidence * 100);
      }
      if (res.fields.expirationDate?.value) {
        setValue('expirationDate', toInputDateFormat(res.fields.expirationDate.value), { shouldValidate: true });
        newSuggestedFields.expirationDate = Math.round(res.fields.expirationDate.confidence * 100);
      }
      if (res.fields.issuingBody?.value) {
        setValue('issuingBody', res.fields.issuingBody.value, { shouldValidate: true });
        newSuggestedFields.issuingBody = Math.round(res.fields.issuingBody.confidence * 100);
      }

      setSuggestedFields(newSuggestedFields);
      setIsExtractionConfirmed(false);
    } catch (err) {
      console.warn('Sugestão automática indisponível:', err);
      setExtractionErrorMsg('Sugestão indisponível; preencha manualmente');
    } finally {
      setIsExtracting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setSelectedFile(null);
      setUploadProgress(null);
      setExtractionSuggestions(null);
      setSuggestedFields({});
      setIsExtractionConfirmed(false);
      setExtractionErrorMsg(null);

      if (documentToEdit) {
        reset({
          title: documentToEdit.title,
          categoryId: documentToEdit.categoryId,
          issuingBody: documentToEdit.issuingBody || '',
          issueDate: toInputDateFormat(documentToEdit.issueDate),
          expirationDate: toInputDateFormat(documentToEdit.expirationDate),
          alertLeadDays: documentToEdit.alertLeadDays || 30,
          responsibleName: documentToEdit.responsibleName || '',
          responsibleEmail: documentToEdit.responsibleEmail || '',
          notes: documentToEdit.notes || '',
          isRenewalInProgress: documentToEdit.status === 'RENEWAL_IN_PROGRESS',
        });
      } else {
        const defaultCategory = categories.find((cat) => cat.name === DEFAULT_CATEGORY_NAME);
        reset({
          title: '',
          categoryId: defaultCategory?.id ?? (categories.length > 0 ? categories[0].id : ''),
          issuingBody: '',
          issueDate: toInputDateFormat(new Date()),
          expirationDate: '',
          alertLeadDays: 30,
          responsibleName: '',
          responsibleEmail: '',
          notes: '',
          isRenewalInProgress: false,
        });
      }
    }
  }, [isOpen, documentToEdit, reset, categories]);

  if (!isOpen) return null;

  const onSubmit = async (values: DocumentFormValues) => {
    if (isLoadingConfig) {
      onError('Aguarde', 'As configurações do sistema ainda estão sendo carregadas.');
      return;
    }

    if (configError) {
      onError('Erro de Configuração', 'Recarregue as configurações antes de salvar.');
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      const payloadValues: DocumentFormData = {
        ...values,
        attachment: selectedFile,
      };

      if (!isEdit && extractionSuggestions && isExtractionConfirmed) {
        payloadValues.extractionSuggestions = extractionSuggestions;
        payloadValues.extractionConfirmed = 'true';
      }

      if (notificationMode === 'ALL_ADMINS') {
        payloadValues.responsibleName = undefined;
        payloadValues.responsibleEmail = undefined;
      }

      if (isEdit && documentToEdit) {
        const formData = buildUpdateFormData(payloadValues);
        const res = await documentService.updateDocument(documentToEdit.id, formData, (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percent);
          }
        });
        onSuccess(res.message || 'Documento atualizado com sucesso.');
        onClose();
      } else {
        const formData = buildCreateFormData(payloadValues);
        const res = await documentService.createDocument(formData, (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percent);
          }
        });
        onSuccess(res.message || 'Documento cadastrado com sucesso.');
        onClose();
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const errorData = axiosError.response?.data;

      if (errorData?.error === 'RESPONSIBLE_REQUIRED') {
        onError(
          'Responsável Obrigatório',
          errorData.message ||
            'O nome e o e-mail do responsável são obrigatórios quando a empresa está configurada no modo "Apenas Responsável".'
        );
      } else if (errorData?.error === 'CATEGORY_NOT_FOUND') {
        onError('Categoria Inválida', errorData.message || 'A categoria selecionada não foi encontrada.');
      } else {
        onError(
          isEdit ? 'Falha ao atualizar documento' : 'Falha ao cadastrar documento',
          errorData?.message || 'Ocorreu um erro ao salvar os dados. Verifique os campos e tente novamente.'
        );
      }
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
      aria-labelledby="document-form-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 id="document-form-title" className="text-lg font-bold text-navy-950">
              {isEdit ? 'Editar Documento' : 'Novo Documento'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEdit
                ? 'Atualize os dados e anexo do documento cadastrado.'
                : 'Preencha as informações para cadastro e monitoramento de vencimento.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
            aria-label="Fechar formulário"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Config loading state or error banner */}
          {isLoadingConfig && (
            <div className="p-3 bg-navy-50/60 border border-navy-200/60 rounded-xl flex items-center space-x-2 text-xs text-navy-900">
              <Loader2 className="w-4 h-4 animate-spin text-navy-600 flex-shrink-0" />
              <span>Carregando configurações de notificação da empresa...</span>
            </div>
          )}

          {configError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-700">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>{configError}</span>
              </div>
              <button
                type="button"
                onClick={loadConfig}
                className="inline-flex items-center font-bold underline hover:text-red-900 ml-2"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Tentar novamente
              </button>
            </div>
          )}

          <form id="document-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Title */}
            <div>
              <label htmlFor="doc-title" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Título do Documento <span className="text-red-500">*</span>
              </label>
              <input
                id="doc-title"
                type="text"
                placeholder="Ex: Alvará de Funcionamento 2026"
                disabled={isSubmitting}
                {...register('title')}
                className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                  errors.title ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                }`}
              />
              {errors.title && (
                <p className="text-xs text-red-600 mt-1 font-medium">{errors.title.message}</p>
              )}
            </div>

            {/* Category & Issuing Body */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="doc-category" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Categoria <span className="text-red-500">*</span>
                </label>
                <select
                  id="doc-category"
                  disabled={isSubmitting}
                  {...register('categoryId')}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    errors.categoryId ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                  }`}
                >
                  <option value="" disabled>
                    Selecione uma categoria...
                  </option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.categoryId.message}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="doc-issuing" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Órgão Emissor
                  </label>
                  {suggestedFields.issuingBody !== undefined && (
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-full border border-purple-200">
                      Sugerido automaticamente · confiança {suggestedFields.issuingBody}%
                    </span>
                  )}
                </div>
                <input
                  id="doc-issuing"
                  type="text"
                  placeholder="Ex: Prefeitura Municipal, Receita Federal"
                  disabled={isSubmitting}
                  {...register('issuingBody', {
                    onChange: () => {
                      if (suggestedFields.issuingBody !== undefined) {
                        setSuggestedFields((prev) => {
                          const next = { ...prev };
                          delete next.issuingBody;
                          return next;
                        });
                      }
                    },
                  })}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    suggestedFields.issuingBody !== undefined
                      ? 'border-purple-400 bg-purple-50/20'
                      : errors.issuingBody
                      ? 'border-red-300 ring-1 ring-red-300'
                      : 'border-slate-200'
                  }`}
                />
                {errors.issuingBody && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.issuingBody.message}</p>
                )}
              </div>
            </div>

            {/* Dates & Alert Days */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="doc-issueDate" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Data de Emissão <span className="text-red-500">*</span>
                  </label>
                  {suggestedFields.issueDate !== undefined && (
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-full border border-purple-200">
                      Sugerido automaticamente · confiança {suggestedFields.issueDate}%
                    </span>
                  )}
                </div>
                <input
                  id="doc-issueDate"
                  type="date"
                  disabled={isSubmitting}
                  {...register('issueDate', {
                    onChange: () => {
                      if (suggestedFields.issueDate !== undefined) {
                        setSuggestedFields((prev) => {
                          const next = { ...prev };
                          delete next.issueDate;
                          return next;
                        });
                      }
                    },
                  })}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    suggestedFields.issueDate !== undefined
                      ? 'border-purple-400 bg-purple-50/20'
                      : errors.issueDate
                      ? 'border-red-300 ring-1 ring-red-300'
                      : 'border-slate-200'
                  }`}
                />
                {errors.issueDate && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.issueDate.message}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="doc-expirationDate" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Data de Vencimento
                  </label>
                  {suggestedFields.expirationDate !== undefined && (
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-full border border-purple-200">
                      Sugerido automaticamente · confiança {suggestedFields.expirationDate}%
                    </span>
                  )}
                </div>
                <input
                  id="doc-expirationDate"
                  type="date"
                  disabled={isSubmitting}
                  {...register('expirationDate', {
                    onChange: () => {
                      if (suggestedFields.expirationDate !== undefined) {
                        setSuggestedFields((prev) => {
                          const next = { ...prev };
                          delete next.expirationDate;
                          return next;
                        });
                      }
                    },
                  })}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    suggestedFields.expirationDate !== undefined
                      ? 'border-purple-400 bg-purple-50/20'
                      : errors.expirationDate
                      ? 'border-red-300 ring-1 ring-red-300'
                      : 'border-slate-200'
                  }`}
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Em branco = Indeterminado</span>
                {errors.expirationDate && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.expirationDate.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="doc-alertLeadDays" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Alerta Prévio (Dias)
                </label>
                <input
                  id="doc-alertLeadDays"
                  type="number"
                  min={1}
                  disabled={isSubmitting}
                  {...register('alertLeadDays', { valueAsNumber: true })}
                  className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                    errors.alertLeadDays ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                  }`}
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Padrão: 30 dias</span>
                {errors.alertLeadDays && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{errors.alertLeadDays.message}</p>
                )}
              </div>
            </div>

            {/* RN-004: Responsible Name and Email if notificationMode === ONLY_RESPONSIBLE */}
            {notificationMode === 'ONLY_RESPONSIBLE' && (
              <div className="p-4 bg-navy-50/50 border border-navy-200/70 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-navy-900 uppercase tracking-wider">
                    Responsável pelo Documento (Modo Apenas Responsável)
                  </span>
                  <span className="text-[10px] bg-navy-100 text-navy-800 font-semibold px-2 py-0.5 rounded-full">
                    Obrigatório
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="doc-respName" className="block text-xs font-medium text-slate-700 mb-1">
                      Nome do Responsável <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="doc-respName"
                      type="text"
                      placeholder="Ex: Carlos Silva"
                      disabled={isSubmitting}
                      {...register('responsibleName')}
                      className={`w-full px-3 py-1.5 bg-white border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                        errors.responsibleName ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                      }`}
                    />
                    {errors.responsibleName && (
                      <p className="text-xs text-red-600 mt-1 font-medium">{errors.responsibleName.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="doc-respEmail" className="block text-xs font-medium text-slate-700 mb-1">
                      E-mail do Responsável <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="doc-respEmail"
                      type="email"
                      placeholder="Ex: carlos.silva@empresa.com"
                      disabled={isSubmitting}
                      {...register('responsibleEmail')}
                      className={`w-full px-3 py-1.5 bg-white border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition ${
                        errors.responsibleEmail ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
                      }`}
                    />
                    {errors.responsibleEmail && (
                      <p className="text-xs text-red-600 mt-1 font-medium">{errors.responsibleEmail.message}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* In Edit mode: Renewal in progress toggle */}
            {isEdit && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Status: Em Renovação</span>
                  <span className="text-[11px] text-slate-500">
                    Marque caso o documento já tenha sido protocolado para renovação junto ao órgão.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isSubmitting}
                    {...register('isRenewalInProgress')}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-navy-700"></div>
                </label>
              </div>
            )}

            {/* Notes */}
            <div>
              <label htmlFor="doc-notes" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Observações / Detalhes Adicionais
              </label>
              <textarea
                id="doc-notes"
                rows={2}
                placeholder="Informações sobre protocolo, condicionantes ou exigências..."
                disabled={isSubmitting}
                {...register('notes')}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition"
              />
            </div>

            {/* File Dropzone */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Anexo do Documento (PDF ou Imagem)
              </label>
              <FileDropzone
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                uploadProgress={uploadProgress}
                existingFileName={documentToEdit?.attachmentFilename}
                existingFileSize={documentToEdit?.fileSizeBytes}
                disabled={isSubmitting || isExtracting}
              />

              {!isEdit && selectedFile && (
                <div className="mt-2.5 flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={handleSuggestFields}
                    disabled={isExtracting || isSubmitting}
                    className="inline-flex items-center px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition disabled:opacity-50"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin text-indigo-600" />
                        Sugerindo campos...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                        Sugerir campos a partir do anexo
                      </>
                    )}
                  </button>
                  {extractionErrorMsg && (
                    <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                      {extractionErrorMsg}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Confirmação obrigatória das sugestões de extração */}
            {!isEdit && extractionSuggestions && (
              <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1">
                <div className="flex items-center space-x-2">
                  <input
                    id="confirm-extraction"
                    type="checkbox"
                    checked={isExtractionConfirmed}
                    onChange={(e) => setIsExtractionConfirmed(e.target.checked)}
                    className="h-4 w-4 rounded border-purple-300 text-navy-600 focus:ring-navy-600 cursor-pointer"
                  />
                  <label htmlFor="confirm-extraction" className="text-xs text-purple-950 font-bold cursor-pointer">
                    Revisei os campos sugeridos e confirmo que estão corretos <span className="text-red-500">*</span>
                  </label>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Modal Footer */}
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
            form="document-form"
            disabled={
              isSubmitting ||
              isLoadingConfig ||
              !!configError ||
              (Boolean(!isEdit && extractionSuggestions) && !isExtractionConfirmed)
            }
            className="btn-primary min-w-[120px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : isEdit ? (
              'Atualizar Documento'
            ) : (
              'Cadastrar Documento'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DocumentFormModal;
