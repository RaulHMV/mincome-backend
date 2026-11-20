import { summarizeBalances } from './balances.calculator';

describe('summarizeBalances (requerimientos-backend.md §3.1)', () => {
  const accounts = [
    { accountId: 'efectivo', type: 'efectivo' as const, balanceCents: 125_000 },
    { accountId: 'nomina', type: 'debito' as const, balanceCents: 520_000 },
    { accountId: 'bbva', type: 'credito' as const, balanceCents: -165_000 },
    { accountId: 'nu', type: 'credito' as const, balanceCents: -80_000 },
  ];

  it('separa Saldo Libre, crédito utilizado y apartados', () => {
    expect(summarizeBalances(accounts, 850_000)).toEqual({
      freeBalanceCents: 645_000,
      creditUsedCents: 245_000,
      pocketsBalanceCents: 850_000,
      // D2: patrimonio neto = libre + apartados − deuda.
      netWorthCents: 645_000 + 850_000 - 245_000,
    });
  });

  it('abonar a un apartado no cambia el patrimonio', () => {
    const before = summarizeBalances(accounts, 850_000);
    const afterDeposit = summarizeBalances(
      accounts.map((a) =>
        a.accountId === 'nomina'
          ? { ...a, balanceCents: a.balanceCents - 50_000 }
          : a,
      ),
      900_000,
    );
    expect(afterDeposit.netWorthCents).toBe(before.netWorthCents);
    expect(afterDeposit.freeBalanceCents).toBe(
      before.freeBalanceCents - 50_000,
    );
  });

  it('comprar con crédito no baja el Saldo Libre, pero sí el patrimonio', () => {
    const before = summarizeBalances(accounts, 0);
    const afterPurchase = summarizeBalances(
      accounts.map((a) =>
        a.accountId === 'bbva'
          ? { ...a, balanceCents: a.balanceCents - 70_000 }
          : a,
      ),
      0,
    );
    expect(afterPurchase.freeBalanceCents).toBe(before.freeBalanceCents);
    expect(afterPurchase.creditUsedCents).toBe(before.creditUsedCents + 70_000);
    expect(afterPurchase.netWorthCents).toBe(before.netWorthCents - 70_000);
  });

  it('pagar la tarjeta baja el Saldo Libre sin mover el patrimonio', () => {
    const before = summarizeBalances(accounts, 0);
    const afterPayment = summarizeBalances(
      accounts.map((a) => {
        if (a.accountId === 'nomina')
          return { ...a, balanceCents: a.balanceCents - 165_000 };
        if (a.accountId === 'bbva') return { ...a, balanceCents: 0 };
        return a;
      }),
      0,
    );
    expect(afterPayment.freeBalanceCents).toBe(
      before.freeBalanceCents - 165_000,
    );
    expect(afterPayment.creditUsedCents).toBe(80_000);
    expect(afterPayment.netWorthCents).toBe(before.netWorthCents);
  });

  it('sin cuentas todo es 0', () => {
    expect(summarizeBalances([], 0)).toEqual({
      freeBalanceCents: 0,
      creditUsedCents: 0,
      pocketsBalanceCents: 0,
      netWorthCents: 0,
    });
  });
});
