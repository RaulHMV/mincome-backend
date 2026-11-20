import type { AlertLevel } from '../common/enums';
import { fromCents, toCents, toMoney } from '../common/money';
import type { CategorySummary } from '../common/summaries';
import { alertLevelFor, budgetPercentage } from './budget.calculator';
import type { EffectiveBudgetRow } from './budgets.repository';

/** Contrato §2, `Budget`: spent, percentage y alertLevel son del mes que se pidió. */
export interface BudgetDto {
  id: string;
  category: CategorySummary;
  limit: number;
  alertThreshold: number;
  spent: number;
  percentage: number;
  alertLevel: AlertLevel;
  isActive: boolean;
  effectiveFrom: string;
}

export function toBudgetDto(
  row: EffectiveBudgetRow,
  spentCents: number,
): BudgetDto {
  const percentage = budgetPercentage(spentCents, toCents(row.limit));
  return {
    id: row.id,
    category: {
      id: row.categoryId,
      name: row.categoryName,
      icon: row.categoryIcon,
    },
    limit: toMoney(row.limit),
    alertThreshold: row.alertThreshold,
    spent: fromCents(spentCents),
    percentage,
    alertLevel: alertLevelFor(percentage, row.alertThreshold),
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
  };
}

/** Los más cerca de excederse primero, como el Dashboard. */
export function byPercentageDesc(a: BudgetDto, b: BudgetDto): number {
  return (
    b.percentage - a.percentage ||
    a.category.name.localeCompare(b.category.name, 'es')
  );
}
