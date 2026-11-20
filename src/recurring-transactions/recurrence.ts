import {
  addDays,
  addMonths,
  dayOfMonthIn,
  diffInDays,
  formatIsoDate,
  lastDayOfMonth,
  maxDate,
  monthOf,
} from '../common/dates';
import { Frequency } from '../common/enums';

/**
 * Una regla por frecuencia, anclada en fecha_inicio (requerimientos-backend.md §2.4):
 * - semanal: cada 7 días desde el inicio.
 * - quincenal: el día 15 y el último día de cada mes (nómina en México).
 * - mensual: el dayOfMonth de cada mes; si el mes es más corto, el último día.
 * - anual: el mismo día y mes del inicio (29 de febrero → 28 en años no bisiestos).
 */
export interface RecurrenceRule {
  frequency: Frequency;
  startDate: string;
  /** Solo en mensual. */
  dayOfMonth: number | null;
  endDate: string | null;
}

/** El aniversario de `startDate` en `year`, con el último día si el mes es más corto. */
function yearlyIn(year: number, startDate: string): string {
  const month = formatIsoDate(year, Number(startDate.slice(5, 7)), 1).slice(
    0,
    7,
  );
  return dayOfMonthIn(month, Number(startDate.slice(8, 10)));
}

/** La primera ocurrencia en `date` o después, o null si ya pasó del fin. */
export function firstOccurrenceOnOrAfter(
  rule: RecurrenceRule,
  date: string,
): string | null {
  const from = maxDate(date, rule.startDate);
  let candidate: string;
  switch (rule.frequency) {
    case Frequency.WEEKLY: {
      const weeks = Math.ceil(diffInDays(rule.startDate, from) / 7);
      candidate = addDays(rule.startDate, weeks * 7);
      break;
    }
    case Frequency.SEMIMONTHLY: {
      const month = monthOf(from);
      const middle = `${month}-15`;
      candidate = from <= middle ? middle : lastDayOfMonth(month);
      break;
    }
    case Frequency.MONTHLY: {
      const day = rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10));
      const month = monthOf(from);
      const inMonth = dayOfMonthIn(month, day);
      candidate =
        inMonth >= from ? inMonth : dayOfMonthIn(addMonths(month, 1), day);
      break;
    }
    case Frequency.YEARLY: {
      const year = Number(from.slice(0, 4));
      const thisYear = yearlyIn(year, rule.startDate);
      candidate =
        thisYear >= from ? thisYear : yearlyIn(year + 1, rule.startDate);
      break;
    }
  }
  return rule.endDate !== null && candidate > rule.endDate ? null : candidate;
}

/** La ocurrencia que sigue a `current`. */
export function nextOccurrence(
  rule: RecurrenceRule,
  current: string,
): string | null {
  return firstOccurrenceOnOrAfter(rule, addDays(current, 1));
}

/** Las ocurrencias entre `from` y `to`, inclusive. Para el calendario. */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: string,
  to: string,
): string[] {
  const occurrences: string[] = [];
  let current = firstOccurrenceOnOrAfter(rule, from);
  while (current !== null && current <= to) {
    occurrences.push(current);
    current = nextOccurrence(rule, current);
  }
  return occurrences;
}
