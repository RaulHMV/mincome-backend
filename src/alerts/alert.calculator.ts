import type { BudgetDto } from '../budgets/budget.mapper';
import type { CardDto } from '../cards/card.mapper';
import { previousDateOfDay } from '../cards/card.calculator';
import { diffInDays } from '../common/dates';
import { AlertLevel } from '../common/enums';
import { toCents } from '../common/money';
import type {
  CardSummary,
  CategorySummary,
  PocketSummary,
} from '../common/summaries';
import { pocketProgress } from '../pockets/pocket.calculator';
import type { PocketRow } from '../pockets/pockets.repository';

// requerimientos-backend.md §3.9.

/** D9: el aviso de pago sale 10 días antes. */
export const CARD_PAYMENT_WINDOW_DAYS = 10;
/** Apartados con fecha meta "cercana". */
export const POCKET_GOAL_WINDOW_DAYS = 30;

export enum AlertType {
  BUDGET = 'budget',
  CARD_PAYMENT = 'cardPayment',
  POCKET_GOAL = 'pocketGoal',
}

interface AlertBase {
  /** Estable mientras la alerta sea la misma: con él se marca como leída. */
  id: string;
  isRead: boolean;
}

export interface BudgetAlert extends AlertBase {
  type: AlertType.BUDGET;
  alertLevel: AlertLevel.WARNING | AlertLevel.EXCEEDED;
  percentage: number;
  budgetId: string;
  category: CategorySummary;
}

export interface CardPaymentAlert extends AlertBase {
  type: AlertType.CARD_PAYMENT;
  dueDate: string;
  daysLeft: number;
  amount: number;
  card: CardSummary;
}

export interface PocketGoalAlert extends AlertBase {
  type: AlertType.POCKET_GOAL;
  targetDate: string;
  daysLeft: number;
  progress: number;
  pocket: PocketSummary;
}

/** Contrato §2, `Alert`. */
export type AlertDto = BudgetAlert | CardPaymentAlert | PocketGoalAlert;

/** Presupuestos del mes actual en preventiva o excedida. */
export function budgetAlert(
  budget: BudgetDto,
  month: string,
): BudgetAlert | null {
  if (budget.alertLevel === AlertLevel.NONE) {
    return null;
  }
  return {
    id: `budget:${budget.id}:${month}`,
    type: AlertType.BUDGET,
    isRead: false,
    alertLevel: budget.alertLevel,
    percentage: budget.percentage,
    budgetId: budget.id,
    category: budget.category,
  };
}

/**
 * Tarjetas de crédito con algo que pagar para no generar intereses y cuya
 * fecha límite llega en 10 días o menos. Solo si esa fecha es la del último
 * corte, que es el que mide paymentToAvoidInterest.
 */
export function cardPaymentAlert(
  card: CardDto,
  today: string,
): CardPaymentAlert | null {
  if (
    card.cutoffDay === null ||
    card.nextDueDate === null ||
    card.paymentToAvoidInterest === null ||
    card.paymentToAvoidInterest <= 0
  ) {
    return null;
  }
  const daysLeft = diffInDays(today, card.nextDueDate);
  const sameStatement =
    previousDateOfDay(card.nextDueDate, card.cutoffDay) ===
    previousDateOfDay(today, card.cutoffDay);
  if (daysLeft > CARD_PAYMENT_WINDOW_DAYS || !sameStatement) {
    return null;
  }
  return {
    id: `cardPayment:${card.id}:${card.nextDueDate}`,
    type: AlertType.CARD_PAYMENT,
    isRead: false,
    dueDate: card.nextDueDate,
    daysLeft,
    amount: card.paymentToAvoidInterest,
    card: {
      id: card.id,
      alias: card.alias,
      last4: card.last4,
      type: card.type,
    },
  };
}

/** Apartados activos con fecha meta en 30 días o menos y sin cumplir. */
export function pocketGoalAlert(
  pocket: PocketRow,
  today: string,
): PocketGoalAlert | null {
  if (
    !pocket.isActive ||
    pocket.targetDate === null ||
    pocket.targetAmount === null
  ) {
    return null;
  }
  const balanceCents = toCents(pocket.balance);
  const targetCents = toCents(pocket.targetAmount);
  const daysLeft = diffInDays(today, pocket.targetDate);
  if (
    balanceCents >= targetCents ||
    daysLeft < 0 ||
    daysLeft > POCKET_GOAL_WINDOW_DAYS
  ) {
    return null;
  }
  return {
    id: `pocketGoal:${pocket.id}`,
    type: AlertType.POCKET_GOAL,
    isRead: false,
    targetDate: pocket.targetDate,
    daysLeft,
    progress: pocketProgress(balanceCents, targetCents) ?? 0,
    pocket: { id: pocket.id, name: pocket.name, icon: pocket.icon },
  };
}

/**
 * Lo que se guarda al leerla. Si cambia (un presupuesto que pasa de
 * preventiva a excedida), la alerta vuelve a salir sin leer.
 */
export function readSignature(alert: AlertDto): string {
  return alert.type === AlertType.BUDGET ? alert.alertLevel : alert.type;
}

/** Lo más urgente primero: pagos por vencer, presupuestos excedidos, avisos y metas. */
export function sortAlerts(alerts: AlertDto[]): AlertDto[] {
  const rank = (alert: AlertDto): [number, number] => {
    switch (alert.type) {
      case AlertType.CARD_PAYMENT:
        return [0, alert.daysLeft];
      case AlertType.BUDGET:
        return [
          alert.alertLevel === AlertLevel.EXCEEDED ? 1 : 2,
          -alert.percentage,
        ];
      case AlertType.POCKET_GOAL:
        return [3, alert.daysLeft];
    }
  };
  return alerts.sort((a, b) => {
    const [groupA, orderA] = rank(a);
    const [groupB, orderB] = rank(b);
    return groupA - groupB || orderA - orderB || a.id.localeCompare(b.id);
  });
}
