import {
  addDays,
  addMonths,
  dayOfMonthIn,
  diffInDays,
  monthOf,
} from '../common/dates';
import { FlowType } from '../common/enums';
import { fromCents } from '../common/money';
import { previousDateOfDay } from '../cards/card.calculator';
import {
  occurrencesBetween,
  type RecurrenceRule,
} from '../recurring-transactions/recurrence';

// requerimientos-backend.md §3.8.

export enum CalendarEventType {
  PAYMENT = 'payment',
  INCOME = 'income',
  CUTOFF = 'cutoff',
}

export enum CalendarEventSource {
  RECURRING_TRANSACTION = 'recurringTransaction',
  CARD = 'card',
}

/** Contrato §2, `CalendarEvent`. */
export interface CalendarEvent {
  date: string;
  type: CalendarEventType;
  /** En eventos de tarjeta es el alias; el front arma "Pago tarjeta …". */
  title: string;
  /** null en cortes y en pagos de tarjeta cuyo corte todavía no pasa. */
  amount: number | null;
  source: { type: CalendarEventSource; id: string };
}

export interface RecurringSource {
  id: string;
  type: FlowType;
  concept: string;
  amountCents: number;
  rule: RecurrenceRule;
}

export interface CreditCardSource {
  id: string;
  alias: string;
  cutoffDay: number;
  dueDay: number;
  usedCreditCents: number;
  /** Del último corte (requerimientos-backend.md §3.5). */
  paymentToAvoidInterestCents: number;
}

/** Las ocurrencias de cada plantilla, también en meses futuros (§2.4). */
export function recurringEvents(
  templates: readonly RecurringSource[],
  from: string,
  to: string,
): CalendarEvent[] {
  return templates.flatMap((template) =>
    occurrencesBetween(template.rule, from, to).map((date): CalendarEvent => ({
      date,
      type:
        template.type === FlowType.INCOME
          ? CalendarEventType.INCOME
          : CalendarEventType.PAYMENT,
      title: template.concept,
      amount: fromCents(template.amountCents),
      source: {
        type: CalendarEventSource.RECURRING_TRANSACTION,
        id: template.id,
      },
    })),
  );
}

/** El día `day` de cada mes entre `from` y `to`, inclusive. */
function datesOfDay(day: number, from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let month = monthOf(from);
    month <= monthOf(to);
    month = addMonths(month, 1)
  ) {
    const date = dayOfMonthIn(month, day);
    if (date >= from && date <= to) {
      dates.push(date);
    }
  }
  return dates;
}

/**
 * Cortes de cada tarjeta de crédito y, si tiene deuda, sus fechas límite de
 * pago. El monto de un pago es paymentToAvoidInterest cuando su corte es el
 * último que ya pasó; si el corte todavía no llega no se sabe cuánto será, y
 * si es de un corte anterior el pago ya quedó en Movimientos: null en los dos
 * casos. Un estado de cuenta ya pagado (0) no sale.
 */
export function cardEvents(
  cards: readonly CreditCardSource[],
  from: string,
  to: string,
  today: string,
): CalendarEvent[] {
  return cards.flatMap((card) => {
    const source = { type: CalendarEventSource.CARD, id: card.id };
    const cutoffs = datesOfDay(card.cutoffDay, from, to).map(
      (date): CalendarEvent => ({
        date,
        type: CalendarEventType.CUTOFF,
        title: card.alias,
        amount: null,
        source,
      }),
    );
    if (card.usedCreditCents <= 0) {
      return cutoffs;
    }
    // Igual que en Mis Tarjetas: el corte de hoy todavía no cierra.
    const lastCutoff = previousDateOfDay(today, card.cutoffDay);
    const payments = datesOfDay(card.dueDay, from, to).flatMap(
      (date): CalendarEvent[] => {
        const statementCutoff = previousDateOfDay(date, card.cutoffDay);
        if (statementCutoff === lastCutoff) {
          if (card.paymentToAvoidInterestCents <= 0) {
            return [];
          }
          return [
            {
              date,
              type: CalendarEventType.PAYMENT,
              title: card.alias,
              amount: fromCents(card.paymentToAvoidInterestCents),
              source,
            },
          ];
        }
        return [
          {
            date,
            type: CalendarEventType.PAYMENT,
            title: card.alias,
            amount: null,
            source,
          },
        ];
      },
    );
    return [...cutoffs, ...payments];
  });
}

const TYPE_ORDER: Record<CalendarEventType, number> = {
  [CalendarEventType.INCOME]: 0,
  [CalendarEventType.PAYMENT]: 1,
  [CalendarEventType.CUTOFF]: 2,
};

/** Por fecha; en el mismo día, ingresos, pagos y cortes. */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.title.localeCompare(b.title, 'es'),
  );
}

export interface ProjectionInput {
  today: string;
  date: string;
  freeBalanceCents: number;
  /** Los del calendario entre mañana y `date`. */
  events: readonly CalendarEvent[];
  extraIncomeCents: number;
  extraExpenseCents: number;
  dailySavingCents: number;
}

/** Contrato §2, `BalanceProjection`. */
export interface BalanceProjection {
  date: string;
  freeBalance: number;
  incomeUntilDate: number;
  paymentsUntilDate: number;
  extraIncome: number;
  extraExpense: number;
  dailySaving: number;
  savingsUntilDate: number;
  projectedFreeBalance: number;
}

/**
 * "Libre para gastar" (§3.8): Saldo Libre + ingresos − pagos + dinero extra
 * − gasto imprevisto − en alcancía. Solo cuenta de mañana en adelante: el
 * Saldo Libre ya incluye lo que pasó hasta hoy.
 */
export function projectBalance(input: ProjectionInput): BalanceProjection {
  const tomorrow = addDays(input.today, 1);
  const window = input.events.filter(
    (event) => event.date >= tomorrow && event.date <= input.date,
  );
  const sumCents = (type: CalendarEventType) =>
    window
      .filter((event) => event.type === type)
      .reduce(
        (total, event) => total + Math.round((event.amount ?? 0) * 100),
        0,
      );
  const incomeCents = sumCents(CalendarEventType.INCOME);
  const paymentsCents = sumCents(CalendarEventType.PAYMENT);
  const savingsCents =
    input.dailySavingCents * Math.max(0, diffInDays(input.today, input.date));
  return {
    date: input.date,
    freeBalance: fromCents(input.freeBalanceCents),
    incomeUntilDate: fromCents(incomeCents),
    paymentsUntilDate: fromCents(paymentsCents),
    extraIncome: fromCents(input.extraIncomeCents),
    extraExpense: fromCents(input.extraExpenseCents),
    dailySaving: fromCents(input.dailySavingCents),
    savingsUntilDate: fromCents(savingsCents),
    projectedFreeBalance: fromCents(
      input.freeBalanceCents +
        incomeCents -
        paymentsCents +
        input.extraIncomeCents -
        input.extraExpenseCents -
        savingsCents,
    ),
  };
}
