import { DocumentStatus } from '@prisma/client';
import { getBusinessToday, MS_PER_DAY } from '../utils/date.js';

/**
 * Normaliza qualquer formato de data (Date, string YYYY-MM-DD ou ISO) para a data civil
 * representada como meia-noite UTC (00:00:00.000Z).
 *
 * Datas de vencimento são gravadas como meia-noite UTC (DOC-27), por isso a leitura usa
 * getters UTC — independente do fuso do processo.
 */
export function normalizeDateToMidnight(dateInput: Date | string | null | undefined): Date | null {
  if (!dateInput) return null;

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return null;

    // Se for formato YYYY-MM-DD
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      return new Date(Date.UTC(year, month, day));
    }

    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return null;
    return new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  }

  return null;
}

/**
 * Calcula a diferença em dias inteiros entre a data de vencimento e hoje.
 * "Hoje" é a data civil de `baseDate` (instante) no fuso de negócio `APP_TIMEZONE`.
 * Retorna número negativo se já venceu.
 */
export function getDaysUntilExpiration(
  expirationDate: Date | string | null | undefined,
  baseDate: Date = new Date()
): number | null {
  const expMidnight = normalizeDateToMidnight(expirationDate);
  if (!expMidnight) return null;

  const todayMidnight = getBusinessToday(baseDate);
  const diffTime = expMidnight.getTime() - todayMidnight.getTime();
  return Math.round(diffTime / MS_PER_DAY);
}

/**
 * Calcula o status de um documento com base na matriz de cores (RN-001 / ARCHITECTURE.md §4):
 * 1. INDETERMINATE se expirationDate for null/undefined/vazio.
 * 2. RENEWAL_IN_PROGRESS se isRenewalInProgress === true.
 * 3. EXPIRED se expirationDate for anterior a hoje (meia-noite).
 * 4. CRITICAL se a diferença em dias for <= alertLeadDays.
 * 5. REGULAR caso contrário.
 *
 * `baseDate` é o instante de referência ("agora"); o dia de hoje é a sua data civil
 * no fuso de negócio `APP_TIMEZONE` (padrão America/Sao_Paulo).
 */
export function calculateDocumentStatus(
  expirationDate: Date | string | null | undefined,
  alertLeadDays: number = 30,
  isRenewalInProgress: boolean = false,
  baseDate: Date = new Date()
): DocumentStatus {
  const expMidnight = normalizeDateToMidnight(expirationDate);

  // 1. Sem data de vencimento -> Validade permanente / Indeterminado
  if (!expMidnight) {
    return DocumentStatus.INDETERMINATE;
  }

  // 2. Sinalização manual de renovação em andamento
  if (isRenewalInProgress) {
    return DocumentStatus.RENEWAL_IN_PROGRESS;
  }

  const todayMidnight = getBusinessToday(baseDate);

  // 3. Data de vencimento anterior ao dia de hoje (meia-noite)
  if (expMidnight.getTime() < todayMidnight.getTime()) {
    return DocumentStatus.EXPIRED;
  }

  // 4. Antecedência crítica de alerta
  const diffDays = Math.round((expMidnight.getTime() - todayMidnight.getTime()) / MS_PER_DAY);

  if (diffDays <= alertLeadDays) {
    return DocumentStatus.CRITICAL;
  }

  // 5. Regular / Em dia
  return DocumentStatus.REGULAR;
}
