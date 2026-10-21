export interface DocumentFormData {
  title: string;
  categoryId: string;
  issuingBody?: string | null;
  issueDate: string;
  expirationDate?: string | null;
  alertLeadDays?: number | string;
  responsibleName?: string | null;
  responsibleEmail?: string | null;
  notes?: string | null;
  isRenewalInProgress?: boolean;
  attachment?: File | null;
  extractionSuggestions?: string | object | null;
  extractionConfirmed?: boolean | string | null;
}

export interface RenewFormData {
  issueDate: string;
  expirationDate?: string | null;
  notes?: string | null;
  attachment?: File | null;
}

/**
 * Creates FormData for document creation.
 * Omit empty optional fields to prevent unexpected defaults.
 */
export function buildCreateFormData(data: DocumentFormData): FormData {
  const fd = new FormData();
  fd.append('title', data.title.trim());
  fd.append('categoryId', data.categoryId);
  fd.append('issueDate', data.issueDate);

  if (data.issuingBody && data.issuingBody.trim()) {
    fd.append('issuingBody', data.issuingBody.trim());
  }
  if (data.expirationDate && data.expirationDate.trim()) {
    fd.append('expirationDate', data.expirationDate.trim());
  }
  if (data.alertLeadDays !== undefined && data.alertLeadDays !== null && data.alertLeadDays !== '') {
    const parsedDays = Number(data.alertLeadDays);
    if (!isNaN(parsedDays)) {
      fd.append('alertLeadDays', String(parsedDays));
    }
  }
  if (data.responsibleName && data.responsibleName.trim()) {
    fd.append('responsibleName', data.responsibleName.trim());
  }
  if (data.responsibleEmail && data.responsibleEmail.trim()) {
    fd.append('responsibleEmail', data.responsibleEmail.trim());
  }
  if (data.notes && data.notes.trim()) {
    fd.append('notes', data.notes.trim());
  }
  if (data.isRenewalInProgress !== undefined) {
    fd.append('isRenewalInProgress', data.isRenewalInProgress ? 'true' : 'false');
  }
  if (data.attachment instanceof File) {
    fd.append('attachment', data.attachment);
  }
  if (data.extractionSuggestions) {
    const serialized =
      typeof data.extractionSuggestions === 'string'
        ? data.extractionSuggestions
        : JSON.stringify(data.extractionSuggestions);
    fd.append('extractionSuggestions', serialized);
  }
  if (data.extractionConfirmed !== undefined && data.extractionConfirmed !== null) {
    fd.append(
      'extractionConfirmed',
      data.extractionConfirmed === true || data.extractionConfirmed === 'true' ? 'true' : 'false'
    );
  }
  return fd;
}

/**
 * Creates FormData for document update.
 * In PUT, empty string '' clears optional fields on backend.
 * Handles renewal state transitions accurately.
 */
export function buildUpdateFormData(data: DocumentFormData): FormData {
  const fd = new FormData();

  if (data.title !== undefined && data.title !== null) {
    fd.append('title', data.title.trim());
  }
  if (data.categoryId !== undefined && data.categoryId !== null) {
    fd.append('categoryId', data.categoryId);
  }
  if (data.issueDate !== undefined && data.issueDate !== null) {
    fd.append('issueDate', data.issueDate);
  }

  // Issuing body: Send '' if empty to clear
  if (data.issuingBody !== undefined) {
    fd.append('issuingBody', data.issuingBody && data.issuingBody.trim() ? data.issuingBody.trim() : '');
  }

  // Expiration date: Send '' if empty to clear
  if (data.expirationDate !== undefined) {
    fd.append('expirationDate', data.expirationDate && data.expirationDate.trim() ? data.expirationDate.trim() : '');
  }

  // Alert lead days
  if (data.alertLeadDays !== undefined && data.alertLeadDays !== null && data.alertLeadDays !== '') {
    const parsedDays = Number(data.alertLeadDays);
    if (!isNaN(parsedDays)) {
      fd.append('alertLeadDays', String(parsedDays));
    }
  }

  // Responsible Name & Email: Send '' if empty to clear
  if (data.responsibleName !== undefined) {
    fd.append('responsibleName', data.responsibleName && data.responsibleName.trim() ? data.responsibleName.trim() : '');
  }
  if (data.responsibleEmail !== undefined) {
    fd.append('responsibleEmail', data.responsibleEmail && data.responsibleEmail.trim() ? data.responsibleEmail.trim() : '');
  }

  // Notes: Send '' if empty to clear
  if (data.notes !== undefined) {
    fd.append('notes', data.notes && data.notes.trim() ? data.notes.trim() : '');
  }

  // Renewal flag semantics:
  // To enter renewal: status='RENEWAL_IN_PROGRESS' and isRenewalInProgress='true'
  // To exit renewal: isRenewalInProgress='false'
  if (data.isRenewalInProgress === true) {
    fd.append('status', 'RENEWAL_IN_PROGRESS');
    fd.append('isRenewalInProgress', 'true');
  } else if (data.isRenewalInProgress === false) {
    fd.append('isRenewalInProgress', 'false');
  }

  // New attachment if selected
  if (data.attachment instanceof File) {
    fd.append('attachment', data.attachment);
  }

  return fd;
}

/**
 * Creates FormData for document renewal.
 */
export function buildRenewFormData(data: RenewFormData): FormData {
  const fd = new FormData();
  fd.append('issueDate', data.issueDate);

  if (data.expirationDate && data.expirationDate.trim()) {
    fd.append('expirationDate', data.expirationDate.trim());
  } else {
    fd.append('expirationDate', '');
  }

  if (data.notes && data.notes.trim()) {
    fd.append('notes', data.notes.trim());
  } else {
    fd.append('notes', '');
  }

  if (data.attachment instanceof File) {
    fd.append('attachment', data.attachment);
  }

  return fd;
}
