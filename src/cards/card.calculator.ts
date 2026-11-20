import { addMonths, dayOfMonthIn, monthOf } from '../common/dates';

// requerimientos-backend.md §3.5. En meses más cortos, el día de corte o de
// pago cae en el último día.

/** El siguiente día `day` a partir de hoy, contando hoy. */
export function nextDateOfDay(today: string, day: number): string {
  const month = monthOf(today);
  const candidate = dayOfMonthIn(month, day);
  return candidate >= today
    ? candidate
    : dayOfMonthIn(addMonths(month, 1), day);
}

/** El último día `day` antes de `date`, sin contar `date`. */
export function previousDateOfDay(date: string, day: number): string {
  const month = monthOf(date);
  const candidate = dayOfMonthIn(month, day);
  return candidate < date ? candidate : dayOfMonthIn(addMonths(month, -1), day);
}

/**
 * Lo que hay que pagar para no generar intereses: la deuda a la fecha del
 * último corte menos lo pagado desde ese corte, nunca negativo.
 */
export function paymentToAvoidInterestCents(
  debtAtLastCutoffCents: number,
  paymentsSinceCutoffCents: number,
): number {
  return Math.max(0, debtAtLastCutoffCents - paymentsSinceCutoffCents);
}

/** Negativo si se pasó del límite. */
export function availableCreditCents(
  limitCents: number,
  usedCreditCents: number,
): number {
  return limitCents - usedCreditCents;
}

/** Más de 12 dígitos seguidos (con espacios o guiones) parece un número de tarjeta (RNF3). */
export function looksLikeCardNumber(value: string): boolean {
  return /(?:\d[\s-]*){13,}/.test(value);
}
