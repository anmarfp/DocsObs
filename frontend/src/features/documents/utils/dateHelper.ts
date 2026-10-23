/**
 * Formats an ISO date string (or Date object) to pt-BR date format (DD/MM/YYYY).
 */
export function formatDate(dateString?: string | Date | null): string {
  if (!dateString) return '-';
  try {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

/**
 * Formats an ISO date string to pt-BR date and time format (DD/MM/YYYY HH:mm).
 */
export function formatDateTime(dateString?: string | Date | null): string {
  if (!dateString) return '-';
  try {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

/**
 * Extracts YYYY-MM-DD from an ISO string for HTML5 date inputs.
 */
export function toInputDateFormat(dateString?: string | Date | null): string {
  if (!dateString) return '';
  try {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Formata um Date como YYYY-MM-DD usando o ano, mês e dia do fuso local do navegador.
 */
export function toLocalInputDateFormat(date: Date = new Date()): string {
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
