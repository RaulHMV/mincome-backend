import { cutDateOf, historyMonths } from './dashboard.calculator';

describe('historyMonths', () => {
  it('regresa los 12 meses que terminan en el mes elegido', () => {
    const months = historyMonths('2026-10', '2024-01-15');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11');
    expect(months[11]).toBe('2026-10');
  });

  it('empieza en el mes del primer saldo inicial, sin rellenar con ceros', () => {
    expect(historyMonths('2026-10', '2026-08-20')).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('cruza el cambio de año y queda vacía sin cuentas o antes del primer saldo', () => {
    expect(historyMonths('2027-01', '2026-12-01')).toEqual([
      '2026-12',
      '2027-01',
    ]);
    expect(historyMonths('2026-10', null)).toEqual([]);
    expect(historyMonths('2026-07', '2026-08-01')).toEqual([]);
  });
});

describe('cutDateOf', () => {
  it('un mes cerrado se mide en su último día; el actual, hoy', () => {
    expect(cutDateOf('2026-09', '2026-10-24')).toBe('2026-09-30');
    expect(cutDateOf('2026-10', '2026-10-24')).toBe('2026-10-24');
    expect(cutDateOf('2026-02', '2026-10-24')).toBe('2026-02-28');
  });
});
