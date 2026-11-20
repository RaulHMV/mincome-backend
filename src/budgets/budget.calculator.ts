import { AlertLevel } from '../common/enums';

// requerimientos-backend.md §3.3.

const RANK: Record<AlertLevel, number> = {
  [AlertLevel.NONE]: 0,
  [AlertLevel.WARNING]: 1,
  [AlertLevel.EXCEEDED]: 2,
};

/**
 * Se trunca en vez de redondear para que el número y la alerta nunca se
 * contradigan: con redondeo, 99.6% se vería como "100%" sin estar excedido.
 */
export function budgetPercentage(
  spentCents: number,
  limitCents: number,
): number {
  return Math.floor((spentCents * 100) / limitCents);
}

export function alertLevelFor(
  percentage: number,
  alertThreshold: number,
): AlertLevel {
  if (percentage >= 100) {
    return AlertLevel.EXCEEDED;
  }
  if (percentage >= alertThreshold) {
    return AlertLevel.WARNING;
  }
  return AlertLevel.NONE;
}

/**
 * El nivel que guarda un gasto (decisión D4): solo el gasto que cruza un
 * umbral guarda 'warning' o 'exceeded'; los que llegan después quedan en
 * 'none', así el aviso sale una vez.
 */
export function crossedAlertLevel(budget: {
  spentBeforeCents: number;
  spentAfterCents: number;
  limitCents: number;
  alertThreshold: number;
}): AlertLevel {
  const before = alertLevelFor(
    budgetPercentage(budget.spentBeforeCents, budget.limitCents),
    budget.alertThreshold,
  );
  const after = alertLevelFor(
    budgetPercentage(budget.spentAfterCents, budget.limitCents),
    budget.alertThreshold,
  );
  return RANK[after] > RANK[before] ? after : AlertLevel.NONE;
}
