import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentFormModal from '@/features/documents/components/DocumentFormModal';
import { documentService } from '@/features/documents/services/documentService';
import { companyService } from '@/features/documents/services/companyService';
import { buildCreateFormData } from '@/features/documents/utils/formDataHelper';
import { AuditDiffViewer } from '@/features/audit/components/AuditDiffViewer';

vi.mock('@/features/documents/services/companyService', () => ({
  companyService: {
    getConfig: vi.fn(),
  },
}));

vi.mock('@/features/documents/services/documentService', () => ({
  documentService: {
    extractFields: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

afterEach(cleanup);

describe('Frontend - Integração do Serviço de Extração de Documentos', () => {
  const categories = [
    { id: 'cat-1', name: 'Fiscal', colorHex: '#3b82f6', description: null },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    categories,
    documentToEdit: null,
  };

  const sampleExtraction = {
    engine: 'tesseract',
    engineVersion: '5.3.0',
    fields: {
      issueDate: { value: '2026-03-15', confidence: 0.95 },
      expirationDate: { value: '2026-09-15', confidence: 0.88 },
      issuingBody: { value: 'Receita Federal do Brasil', confidence: 0.92 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(companyService.getConfig).mockResolvedValue({
      id: 'cfg-1',
      notificationMode: 'ALL_ADMINS',
      alertLeadDays: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  describe('formDataHelper', () => {
    it('inclui extractionSuggestions e extractionConfirmed no payload de criação', () => {
      const base = {
        title: 'Certidão Federal',
        categoryId: 'cat-1',
        issueDate: '2026-03-15',
        extractionSuggestions: sampleExtraction,
        extractionConfirmed: 'true',
      };

      const fd = buildCreateFormData(base);
      expect(fd.get('title')).toBe('Certidão Federal');
      expect(fd.get('extractionConfirmed')).toBe('true');
      expect(fd.get('extractionSuggestions')).toBe(JSON.stringify(sampleExtraction));
    });
  });

  describe('AuditDiffViewer', () => {
    it('mostra selos de Automático e Digitado de acordo com fieldOrigins', () => {
      render(
        <AuditDiffViewer
          diffData={{
            title: { new: 'Certidão Negativa' },
            issueDate: { new: '2026-03-15' },
            expirationDate: { new: '2026-09-15' },
            issuingBody: { new: 'Prefeitura' },
            fieldOrigins: {
              issueDate: 'AUTO',
              expirationDate: 'AUTO',
              issuingBody: 'MANUAL',
            },
            extraction: {
              engine: 'tesseract',
              confidence: { issueDate: 0.95, expirationDate: 0.88, issuingBody: 0.92 },
            },
          }}
        />
      );

      const automators = screen.getAllByText('Automático');
      expect(automators.length).toBe(2);

      const manual = screen.getByText('Digitado');
      expect(manual).toBeInTheDocument();

      expect(screen.getByText(/Módulo de Extração: tesseract/i)).toBeInTheDocument();
    });
  });

  describe('DocumentFormModal com Sugestão de Anexo', () => {
    it('exibe botão de sugestão ao selecionar arquivo, pré-preenche campos e exibe selos', async () => {
      vi.mocked(documentService.extractFields).mockResolvedValue(sampleExtraction);

      render(<DocumentFormModal {...defaultProps} />);
      await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

      // Antes de selecionar arquivo, o botão de sugerir não aparece
      expect(screen.queryByText(/Sugerir campos a partir do anexo/i)).not.toBeInTheDocument();

      // Seleciona um arquivo PDF via dropzone
      const zone = screen.getByRole('button', { name: /área de upload/i });
      const testFile = new File(['%PDF-1.4'], 'documento.pdf', { type: 'application/pdf' });
      fireEvent.drop(zone, { dataTransfer: { files: [testFile] } });

      // O botão de sugestão passa a ser exibido
      const suggestButton = await screen.findByRole('button', {
        name: /Sugerir campos a partir do anexo/i,
      });
      expect(suggestButton).toBeInTheDocument();

      // Clica no botão de sugerir
      fireEvent.click(suggestButton);

      await waitFor(() => {
        expect(documentService.extractFields).toHaveBeenCalledWith(testFile);
      });

      // Campos pré-preenchidos com valores sugeridos
      const issueInput = screen.getByLabelText(/Data de Emissão/i) as HTMLInputElement;
      expect(issueInput.value).toBe('2026-03-15');

      const expInput = screen.getByLabelText(/Data de Vencimento/i) as HTMLInputElement;
      expect(expInput.value).toBe('2026-09-15');

      const issuingInput = screen.getByLabelText(/Órgão Emissor/i) as HTMLInputElement;
      expect(issuingInput.value).toBe('Receita Federal do Brasil');

      // Selos de confiança exibidos
      expect(screen.getByText(/confiança 95%/i)).toBeInTheDocument();
      expect(screen.getByText(/confiança 88%/i)).toBeInTheDocument();
      expect(screen.getByText(/confiança 92%/i)).toBeInTheDocument();

      // Caixa de confirmação obrigatória é exibida
      expect(
        screen.getByText(/Revisei os campos sugeridos e confirmo que estão corretos/i)
      ).toBeInTheDocument();
    });

    it('exige confirmação explícita antes de habilitar o botão de submissão', async () => {
      vi.mocked(documentService.extractFields).mockResolvedValue(sampleExtraction);

      render(<DocumentFormModal {...defaultProps} />);
      await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

      const zone = screen.getByRole('button', { name: /área de upload/i });
      const testFile = new File(['%PDF-1.4'], 'documento.pdf', { type: 'application/pdf' });
      fireEvent.drop(zone, { dataTransfer: { files: [testFile] } });

      const suggestButton = await screen.findByRole('button', {
        name: /Sugerir campos a partir do anexo/i,
      });
      fireEvent.click(suggestButton);

      await screen.findByText(/confiança 95%/i);

      // Botão de salvar fica desabilitado sem o checkbox marcado
      const submitButton = screen.getByRole('button', { name: /Cadastrar Documento/i });
      expect(submitButton).toBeDisabled();

      // Marca a caixa de confirmação
      const checkbox = screen.getByRole('checkbox', {
        name: /Revisei os campos sugeridos e confirmo que estão corretos/i,
      });
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      // Agora o botão de salvar fica habilitado
      expect(submitButton).not.toBeDisabled();
    });

    it('remove o selo do campo quando o usuário o edita manualmente', async () => {
      vi.mocked(documentService.extractFields).mockResolvedValue(sampleExtraction);

      render(<DocumentFormModal {...defaultProps} />);
      await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

      const zone = screen.getByRole('button', { name: /área de upload/i });
      fireEvent.drop(zone, {
        dataTransfer: {
          files: [new File(['%PDF-1.4'], 'documento.pdf', { type: 'application/pdf' })],
        },
      });

      const suggestButton = await screen.findByRole('button', {
        name: /Sugerir campos a partir do anexo/i,
      });
      fireEvent.click(suggestButton);

      await screen.findByText(/confiança 92%/i);

      // Usuário altera o órgão emissor
      const issuingInput = screen.getByLabelText(/Órgão Emissor/i);
      fireEvent.change(issuingInput, { target: { value: 'Outro Órgão Alterado' } });

      // O selo do órgão emissor desaparece
      expect(screen.queryByText(/confiança 92%/i)).not.toBeInTheDocument();
      // Os selos das outras datas permanecem
      expect(screen.getByText(/confiança 95%/i)).toBeInTheDocument();
      expect(screen.getByText(/confiança 88%/i)).toBeInTheDocument();
    });

    it('exibe mensagem discreta em caso de falha 503 sem bloquear preenchimento manual', async () => {
      vi.mocked(documentService.extractFields).mockRejectedValue({
        response: { status: 503, data: { message: 'Serviço de extração indisponível' } },
      });

      render(<DocumentFormModal {...defaultProps} />);
      await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

      const zone = screen.getByRole('button', { name: /área de upload/i });
      fireEvent.drop(zone, {
        dataTransfer: {
          files: [new File(['%PDF-1.4'], 'documento.pdf', { type: 'application/pdf' })],
        },
      });

      const suggestButton = await screen.findByRole('button', {
        name: /Sugerir campos a partir do anexo/i,
      });
      fireEvent.click(suggestButton);

      // Mensagem discreta é exibida
      const errorMsg = await screen.findByText(/Sugestão indisponível; preencha manualmente/i);
      expect(errorMsg).toBeInTheDocument();

      // Botão de salvar não fica bloqueado por confirmação de extração
      const submitButton = screen.getByRole('button', { name: /Cadastrar Documento/i });
      expect(submitButton).not.toBeDisabled();
      expect(
        screen.queryByText(/Revisei os campos sugeridos e confirmo que estão corretos/i)
      ).not.toBeInTheDocument();
    });

    it('envia extractionSuggestions e extractionConfirmed no FormData ao submeter com sugestão confirmada', async () => {
      vi.mocked(documentService.extractFields).mockResolvedValue(sampleExtraction);
      vi.mocked(documentService.createDocument).mockResolvedValue({
        message: 'Documento criado com sucesso',
        document: {} as any,
      });

      render(<DocumentFormModal {...defaultProps} />);
      await waitFor(() => expect(companyService.getConfig).toHaveBeenCalled());

      // Preenche título obrigatório
      const titleInput = screen.getByLabelText(/Título do Documento/i);
      fireEvent.change(titleInput, { target: { value: 'Documento Teste Extração' } });

      // Anexa arquivo e pede sugestão
      const zone = screen.getByRole('button', { name: /área de upload/i });
      const file = new File(['%PDF-1.4'], 'alvara.pdf', { type: 'application/pdf' });
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });

      const suggestButton = await screen.findByRole('button', {
        name: /Sugerir campos a partir do anexo/i,
      });
      fireEvent.click(suggestButton);

      await screen.findByText(/confiança 95%/i);

      // Confirma as sugestões
      const checkbox = screen.getByRole('checkbox', {
        name: /Revisei os campos sugeridos e confirmo que estão corretos/i,
      });
      fireEvent.click(checkbox);

      // Submete o formulário
      const submitButton = screen.getByRole('button', { name: /Cadastrar Documento/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(documentService.createDocument).toHaveBeenCalled();
      });

      const calledFormData = vi.mocked(documentService.createDocument).mock.calls[0][0] as FormData;
      expect(calledFormData.get('title')).toBe('Documento Teste Extração');
      expect(calledFormData.get('extractionConfirmed')).toBe('true');
      expect(calledFormData.get('extractionSuggestions')).toBe(JSON.stringify(sampleExtraction));
    });
  });
});
