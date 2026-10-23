/**
 * Utilitários de data civil (DOC-27).
 *
 * Convenção do sistema:
 * - Campos "somente data" (ex.: `expirationDate`) são datas civis representadas
 *   como meia-noite UTC (`YYYY-MM-DDT00:00:00.000Z`). Sempre devem ser lidos com
 *   getters UTC (`getUTC*`/`Date.UTC`), nunca com getters locais — caso contrário
 *   um processo em UTC-3 enxerga o dia anterior.
 * - "Hoje" é a data civil corrente no fuso de negócio `APP_TIMEZONE`
 *   (padrão `America/Sao_Paulo`), também representada como meia-noite UTC.
 */

import { env } from '../config/env.js';

export const DEFAULT_APP_TIMEZONE = 'America/Sao_Paulo';

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna o fuso de negócio configurado em `APP_TIMEZONE` (padrão
 * `America/Sao_Paulo`). Valores inválidos caem no padrão.
 */
export function getAppTimeZone(): string {
  const configured = env.APP_TIMEZONE?.trim();
  if (configured && isValidTimeZone(configured)) return configured;
  return DEFAULT_APP_TIMEZONE;
}

/**
 * Converte um instante na data civil correspondente no fuso informado,
 * representada como meia-noite UTC dessa data.
 */
export function getCivilDateInTimeZone(instant: Date, timeZone: string = getAppTimeZone()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    parseInt(parts.find((part) => part.type === type)!.value, 10);

  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/**
 * "Hoje" no fuso de negócio, como meia-noite UTC da data civil.
 * @param now instante de referência (padrão: relógio atual)
 */
export function getBusinessToday(now: Date = new Date()): Date {
  return getCivilDateInTimeZone(now);
}

/** Soma (ou subtrai) dias inteiros a uma data civil em meia-noite UTC. */
export function addCivilDays(civilDate: Date, days: number): Date {
  return new Date(civilDate.getTime() + days * MS_PER_DAY);
}

/**
 * Normaliza uma string de data (`YYYY-MM-DD` ou ISO) ou `Date` para a data civil
 * correspondente representada como meia-noite UTC (`YYYY-MM-DDT00:00:00.000Z`).
 */
export function parseCivilDate(input: string | Date): Date {
  if (typeof input === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim());
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    }
  }
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    parseInt(parts.find((part) => part.type === type)!.value, 10);

  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
  const instantSecondsMs = Math.floor(instant.getTime() / 1000) * 1000;
  return wallClockAsUtc - instantSecondsMs;
}

/**
 * Retorna o instante UTC correspondente à meia-noite local (00:00:00.000) de uma
 * data civil no fuso informado (padrão `APP_TIMEZONE`).
 */
export function getStartOfCivilDayInTimeZone(
  civilDateInput: string | Date,
  timeZone: string = getAppTimeZone()
): Date {
  const civilDate = parseCivilDate(civilDateInput);
  const utcMidnightMs = civilDate.getTime();
  const firstGuess = utcMidnightMs - getTimeZoneOffsetMs(new Date(utcMidnightMs), timeZone);
  const secondOffset = getTimeZoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(utcMidnightMs - secondOffset);
}
