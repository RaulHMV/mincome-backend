// Fechas como texto 'YYYY-MM-DD' y meses como 'YYYY-MM', igual que en la BD
// y en el contrato. Se comparan como texto: el orden alfabético de una fecha
// ISO es su orden cronológico.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function parseIsoDate(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

function toUtcMs(date: string): number {
  const [year, month, day] = parseIsoDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  const value = new Date(ms);
  return formatIsoDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
  );
}

export function formatIsoDate(
  year: number,
  month: number,
  day: number,
): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  );
}

export function isIsoMonth(value: string): boolean {
  const match = ISO_MONTH.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Días de `from` a `to` (negativo si `to` es anterior). */
export function diffInDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const index = year * 12 + (monthNumber - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

export function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

export function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(year, monthNumber))}`;
}

/** El día `day` del mes; en meses más cortos, el último día. */
export function dayOfMonthIn(month: string, day: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${pad(Math.min(day, daysInMonth(year, monthNumber)))}`;
}

export function dayOf(date: string): number {
  return parseIsoDate(date)[2];
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    cache.set(timeZone, formatter);
  }
  return formatter;
}

function partsOf(formatter: Intl.DateTimeFormat, value: Date) {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(value)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** "Hoy" en la zona horaria del usuario (requerimientos-backend.md §2.6). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = partsOf(
    cachedFormatter(dateFormatters, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    now,
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** TIMESTAMPTZ como ISO 8601 con el desfase de la zona del usuario: "2026-10-24T14:20:00-06:00". */
export function formatTimestamp(value: Date, timeZone: string): string {
  const parts = partsOf(
    cachedFormatter(timestampFormatters, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }),
    value,
  );
  const offset =
    parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.slice(3);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function formatTimestampOrNull(
  value: Date | null,
  timeZone: string,
): string | null {
  return value === null ? null : formatTimestamp(value, timeZone);
}

/** TIME de la BD ('14:20:00') como 'HH:MM'. */
export function formatTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

let supportedTimeZones: Set<string> | undefined;

/** Solo nombres IANA, que PostgreSQL entiende igual que JavaScript. */
export function isValidTimeZone(timeZone: string): boolean {
  supportedTimeZones ??= new Set([
    ...Intl.supportedValuesOf('timeZone'),
    'UTC',
  ]);
  return supportedTimeZones.has(timeZone);
}
