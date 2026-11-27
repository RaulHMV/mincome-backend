import { FlowType, Frequency } from '../common/enums';
import {
  CalendarEventSource,
  CalendarEventType,
  cardEvents,
  projectBalance,
  recurringEvents,
  sortEvents,
  type CalendarEvent,
  type CreditCardSource,
} from './calendar.calculator';

const rent = {
  id: 'r-renta',
  type: FlowType.EXPENSE,
  concept: 'Renta departamento',
  amountCents: 320_000,
  rule: {
    frequency: Frequency.MONTHLY,
    startDate: '2026-08-01',
    dayOfMonth: 1,
    endDate: null,
  },
};

const payroll = {
  id: 'r-nomina',
  type: FlowType.INCOME,
  concept: 'Nómina quincenal',
  amountCents: 500_000,
  rule: {
    frequency: Frequency.SEMIMONTHLY,
    startDate: '2026-08-15',
    dayOfMonth: null,
    endDate: null,
  },
};

const bbva: CreditCardSource = {
  id: 't-bbva',
  alias: 'BBVA Oro',
  cutoffDay: 12,
  dueDay: 2,
  usedCreditCents: 245_000,
  paymentToAvoidInterestCents: 165_000,
};

describe('recurringEvents', () => {
  it('proyecta las ocurrencias del mes, también en meses futuros', () => {
    expect(
      recurringEvents([rent, payroll], '2026-12-01', '2026-12-31'),
    ).toEqual([
      {
        date: '2026-12-01',
        type: CalendarEventType.PAYMENT,
        title: 'Renta departamento',
        amount: 3200,
        source: {
          type: CalendarEventSource.RECURRING_TRANSACTION,
          id: 'r-renta',
        },
      },
      expect.objectContaining({
        date: '2026-12-15',
        type: CalendarEventType.INCOME,
        amount: 5000,
      }),
      expect.objectContaining({
        date: '2026-12-31',
        type: CalendarEventType.INCOME,
        amount: 5000,
      }),
    ]);
  });

  it('respeta el inicio y el fin de la plantilla', () => {
    const ending = {
      ...rent,
      rule: { ...rent.rule, startDate: '2026-10-01', endDate: '2026-11-30' },
    };
    expect(recurringEvents([ending], '2026-09-01', '2026-09-30')).toEqual([]);
    expect(recurringEvents([ending], '2026-11-01', '2026-11-30')).toHaveLength(
      1,
    );
    expect(recurringEvents([ending], '2026-12-01', '2026-12-31')).toEqual([]);
  });
});

describe('cardEvents', () => {
  // Hoy es 20 de octubre: el último corte fue el 12.
  const today = '2026-10-20';

  it('el pago cuyo corte ya pasó lleva paymentToAvoidInterest; el corte, monto nulo', () => {
    expect(cardEvents([bbva], '2026-11-01', '2026-11-30', today)).toEqual([
      expect.objectContaining({
        date: '2026-11-12',
        type: CalendarEventType.CUTOFF,
        amount: null,
      }),
      {
        date: '2026-11-02',
        type: CalendarEventType.PAYMENT,
        title: 'BBVA Oro',
        amount: 1650,
        source: { type: CalendarEventSource.CARD, id: 't-bbva' },
      },
    ]);
  });

  it('el pago de un corte que no ha llegado sale sin monto', () => {
    const december = cardEvents([bbva], '2026-12-01', '2026-12-31', today);
    expect(
      december.find((event) => event.type === CalendarEventType.PAYMENT),
    ).toMatchObject({
      date: '2026-12-02',
      amount: null,
    });
  });

  it('sin deuda solo salen los cortes; con el estado de cuenta pagado, tampoco su pago', () => {
    const paidOff = {
      ...bbva,
      usedCreditCents: 0,
      paymentToAvoidInterestCents: 0,
    };
    expect(
      cardEvents([paidOff], '2026-11-01', '2026-11-30', today).map(
        (event) => event.type,
      ),
    ).toEqual([CalendarEventType.CUTOFF]);
    const statementPaid = { ...bbva, paymentToAvoidInterestCents: 0 };
    expect(
      cardEvents([statementPaid], '2026-11-01', '2026-11-30', today).map(
        (event) => event.type,
      ),
    ).toEqual([CalendarEventType.CUTOFF]);
  });

  it('en meses más cortos el corte cae en el último día', () => {
    const endOfMonth = { ...bbva, cutoffDay: 31, usedCreditCents: 0 };
    expect(
      cardEvents([endOfMonth], '2027-02-01', '2027-02-28', today)[0].date,
    ).toBe('2027-02-28');
  });
});

describe('sortEvents', () => {
  it('ordena por fecha y, en el mismo día, ingresos, pagos y cortes', () => {
    const event = (
      date: string,
      type: CalendarEventType,
      title = 'x',
    ): CalendarEvent => ({
      date,
      type,
      title,
      amount: null,
      source: { type: CalendarEventSource.CARD, id: title },
    });
    expect(
      sortEvents([
        event('2026-10-12', CalendarEventType.CUTOFF),
        event('2026-10-12', CalendarEventType.PAYMENT),
        event('2026-10-01', CalendarEventType.CUTOFF),
        event('2026-10-12', CalendarEventType.INCOME),
      ]).map((item) => `${item.date} ${item.type}`),
    ).toEqual([
      '2026-10-01 cutoff',
      '2026-10-12 income',
      '2026-10-12 payment',
      '2026-10-12 cutoff',
    ]);
  });
});

describe('projectBalance', () => {
  const events = [
    ...recurringEvents([rent, payroll], '2026-10-01', '2026-10-31'),
    ...cardEvents([bbva], '2026-10-01', '2026-10-31', '2026-10-24'),
  ];

  it('solo cuenta de mañana en adelante: la renta del día 1 ya está en el Saldo Libre', () => {
    // El error del simulador de hoy (§3.8): volver a restar la renta del 1.
    expect(
      projectBalance({
        today: '2026-10-24',
        date: '2026-10-31',
        freeBalanceCents: 645_000,
        events,
        extraIncomeCents: 0,
        extraExpenseCents: 0,
        dailySavingCents: 0,
      }),
    ).toEqual({
      date: '2026-10-31',
      freeBalance: 6450,
      incomeUntilDate: 5000,
      paymentsUntilDate: 0,
      extraIncome: 0,
      extraExpense: 0,
      dailySaving: 0,
      savingsUntilDate: 0,
      projectedFreeBalance: 11450,
    });
  });

  it('el ahorro diario se multiplica por los días que faltan, no por el número de día', () => {
    const projection = projectBalance({
      today: '2026-10-24',
      date: '2026-10-31',
      freeBalanceCents: 645_000,
      events: [],
      extraIncomeCents: 100_050,
      extraExpenseCents: 30_000,
      dailySavingCents: 5_000,
    });
    expect(projection.savingsUntilDate).toBe(350); // 7 días × 50
    expect(projection.projectedFreeBalance).toBe(6450 + 1000.5 - 300 - 350);
  });

  it('para hoy no proyecta nada: es el Saldo Libre', () => {
    const projection = projectBalance({
      today: '2026-10-24',
      date: '2026-10-24',
      freeBalanceCents: 645_000,
      events,
      extraIncomeCents: 0,
      extraExpenseCents: 0,
      dailySavingCents: 5_000,
    });
    expect(projection.projectedFreeBalance).toBe(6450);
  });

  it('suma en centavos: sin errores de punto flotante', () => {
    const cents = (amount: number): CalendarEvent => ({
      date: '2026-10-25',
      type: CalendarEventType.PAYMENT,
      title: 'x',
      amount,
      source: { type: CalendarEventSource.RECURRING_TRANSACTION, id: 'x' },
    });
    const projection = projectBalance({
      today: '2026-10-24',
      date: '2026-10-31',
      freeBalanceCents: 30,
      events: [cents(0.1), cents(0.2)],
      extraIncomeCents: 0,
      extraExpenseCents: 0,
      dailySavingCents: 0,
    });
    expect(projection.paymentsUntilDate).toBe(0.3);
    expect(projection.projectedFreeBalance).toBe(0);
  });
});
