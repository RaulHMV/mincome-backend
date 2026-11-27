import { AlertLevel } from '../common/enums';
import {
  alertLevelFor,
  budgetPercentage,
  crossedAlertLevel,
} from './budget.calculator';

describe('budget.calculator (requerimientos-backend.md §3.3)', () => {
  it('trunca el porcentaje: $820 de $800 es 102%', () => {
    expect(budgetPercentage(82_000, 80_000)).toBe(102);
    expect(budgetPercentage(126_000, 150_000)).toBe(84);
    expect(budgetPercentage(0, 80_000)).toBe(0);
  });

  it('99.6% se queda en 99 y no se ve como excedido', () => {
    expect(budgetPercentage(79_680, 80_000)).toBe(99);
    expect(alertLevelFor(99, 80)).toBe(AlertLevel.WARNING);
  });

  it('usa el umbral de cada presupuesto', () => {
    expect(alertLevelFor(84, 80)).toBe(AlertLevel.WARNING);
    expect(alertLevelFor(84, 85)).toBe(AlertLevel.NONE);
    expect(alertLevelFor(85, 85)).toBe(AlertLevel.WARNING);
    expect(alertLevelFor(100, 80)).toBe(AlertLevel.EXCEEDED);
  });

  it('marca solo el gasto que cruza un umbral (D4)', () => {
    const budget = { limitCents: 80_000, alertThreshold: 80 };
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 60_000,
        spentAfterCents: 63_000,
      }),
    ).toBe(AlertLevel.NONE);
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 60_000,
        spentAfterCents: 64_000,
      }),
    ).toBe(AlertLevel.WARNING);
    // Ya estaba en preventiva: el siguiente gasto no repite el aviso.
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 64_000,
        spentAfterCents: 70_000,
      }),
    ).toBe(AlertLevel.NONE);
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 70_000,
        spentAfterCents: 82_000,
      }),
    ).toBe(AlertLevel.EXCEEDED);
    // Pasa de ninguna a excedida de un golpe.
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 0,
        spentAfterCents: 90_000,
      }),
    ).toBe(AlertLevel.EXCEEDED);
    expect(
      crossedAlertLevel({
        ...budget,
        spentBeforeCents: 82_000,
        spentAfterCents: 90_000,
      }),
    ).toBe(AlertLevel.NONE);
  });
});
