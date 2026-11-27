import { addMonths, lastDayOfMonth, minDate, monthOf } from '../common/dates';

/** El patrimonio de cada mes se mide al cierre del mes, o hoy si no ha cerrado. */
export function cutDateOf(month: string, today: string): string {
  return minDate(lastDayOfMonth(month), today);
}

/**
 * Los `count` meses que terminan en `month`, pero solo desde el mes de la
 * primera fecha_saldo_inicial del usuario: sin rellenar con ceros
 * (requerimientos-backend.md §3.1).
 */
export function historyMonths(
  month: string,
  firstInitialBalanceDate: string | null,
  count = 12,
): string[] {
  if (firstInitialBalanceDate === null) {
    return [];
  }
  const firstMonth = monthOf(firstInitialBalanceDate);
  return Array.from({ length: count }, (_, index) =>
    addMonths(month, index - count + 1),
  ).filter((candidate) => candidate >= firstMonth);
}
