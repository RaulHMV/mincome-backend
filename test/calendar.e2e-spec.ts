import { previousDateOfDay } from '../src/cards/card.calculator';
import {
  addDays,
  addMonths,
  dayOfMonthIn,
  firstDayOfMonth,
  lastDayOfMonth,
} from '../src/common/dates';
import {
  CATEGORY,
  currentMonth,
  setUpUser,
  today,
  type UserSetup,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

interface CalendarEvent {
  date: string;
  type: 'payment' | 'income' | 'cutoff';
  title: string;
  amount: number | null;
  source: { type: string; id: string };
}

describe('Calendario y proyección (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  let rentId: string;
  let payrollId: string;
  let cardId: string;
  const nextMonth = addMonths(currentMonth(), 1);

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-calendario', {
      debitBalance: 10_000,
    });
    const recurring = (body: Record<string, unknown>) =>
      ana.client.post('/recurring-transactions').send({
        paymentMethod: 'transfer',
        accountId: ana.debitId,
        endDate: null,
        startDate: firstDayOfMonth(nextMonth),
        ...body,
      });
    rentId = (
      await recurring({
        type: 'expense',
        subtype: 'fixed',
        categoryId: CATEGORY.HOME,
        amount: 3200,
        concept: 'Renta departamento',
        frequency: 'monthly',
        dayOfMonth: 1,
      }).expect(201)
    ).body.recurringTransaction.id;
    payrollId = (
      await recurring({
        type: 'income',
        subtype: 'recurring',
        categoryId: CATEGORY.PAYROLL,
        amount: 5000,
        concept: 'Nómina quincenal',
        frequency: 'semimonthly',
      }).expect(201)
    ).body.recurringTransaction.id;
    cardId = (
      await ana.client
        .post('/cards')
        .send({
          alias: 'BBVA Oro',
          bank: 'BBVA',
          last4: '4821',
          type: 'credit',
          creditLimit: 7000,
          cutoffDay: 12,
          dueDay: 2,
          initialDebt: 1650,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => testApp.close());

  async function calendar(month: string): Promise<CalendarEvent[]> {
    const response = await ana.client
      .get(`/calendar?month=${month}`)
      .expect(200);
    expect(response.body.month).toBe(month);
    return response.body.events;
  }

  it('el mes trae recurrentes, cortes y pagos de tarjeta, ordenados por fecha', async () => {
    const events = await calendar(nextMonth);
    const due = dayOfMonthIn(nextMonth, 2);
    // Su corte es el 12 de este mes: si ya pasó, el monto es lo que hay que pagar.
    const statementClosed =
      previousDateOfDay(due, 12) === previousDateOfDay(today(), 12);
    expect(events).toEqual([
      {
        date: firstDayOfMonth(nextMonth),
        type: 'payment',
        title: 'Renta departamento',
        amount: 3200,
        source: { type: 'recurringTransaction', id: rentId },
      },
      {
        date: due,
        type: 'payment',
        title: 'BBVA Oro',
        amount: statementClosed ? 1650 : null,
        source: { type: 'card', id: cardId },
      },
      {
        date: dayOfMonthIn(nextMonth, 12),
        type: 'cutoff',
        title: 'BBVA Oro',
        amount: null,
        source: { type: 'card', id: cardId },
      },
      expect.objectContaining({
        date: `${nextMonth}-15`,
        type: 'income',
        source: { type: 'recurringTransaction', id: payrollId },
      }),
      expect.objectContaining({
        date: lastDayOfMonth(nextMonth),
        type: 'income',
        amount: 5000,
      }),
    ]);
  });

  it('el pago de un corte que todavía no llega sale sin monto', async () => {
    const events = await calendar(addMonths(currentMonth(), 2));
    expect(
      events.find(
        (event) => event.source.id === cardId && event.type === 'payment',
      ),
    ).toMatchObject({
      amount: null,
    });
  });

  it('una recurrente pausada no sale', async () => {
    await ana.client
      .patch(`/recurring-transactions/${rentId}`)
      .send({ isActive: false })
      .expect(200);
    const events = await calendar(nextMonth);
    expect(events.some((event) => event.source.id === rentId)).toBe(false);
    await ana.client
      .patch(`/recurring-transactions/${rentId}`)
      .send({ isActive: true })
      .expect(200);
  });

  it('la proyección suma justo los eventos del calendario de mañana a la fecha', async () => {
    const date = lastDayOfMonth(nextMonth);
    const tomorrow = addDays(today(), 1);
    const window = [
      ...(await calendar(currentMonth())),
      ...(await calendar(nextMonth)),
    ].filter((event) => event.date >= tomorrow && event.date <= date);
    const sum = (type: string) =>
      window
        .filter((event) => event.type === type)
        .reduce(
          (total, event) => total + Math.round((event.amount ?? 0) * 100),
          0,
        ) / 100;

    const response = await ana.client
      .get(
        `/balance-projections?date=${date}&extraIncome=1000.50&extraExpense=300&dailySaving=10`,
      )
      .expect(200);
    const days = Math.round(
      (Date.parse(date) - Date.parse(today())) / 86_400_000,
    );
    expect(response.body).toEqual({
      date,
      freeBalance: 10_000,
      incomeUntilDate: sum('income'),
      paymentsUntilDate: sum('payment'),
      extraIncome: 1000.5,
      extraExpense: 300,
      dailySaving: 10,
      savingsUntilDate: days * 10,
      projectedFreeBalance:
        Math.round(
          (10_000 + sum('income') - sum('payment') + 1000.5 - 300 - days * 10) *
            100,
        ) / 100,
    });
  });

  it('valida la fecha y los montos del simulador', async () => {
    const cases: [string, string][] = [
      [`?date=${addDays(today(), -1)}`, 'date'],
      [`?date=${addDays(today(), 400)}`, 'date'],
      ['', 'date'],
      [`?date=${today()}&dailySaving=-5`, 'dailySaving'],
      [`?date=${today()}&extraIncome=1.234`, 'extraIncome'],
    ];
    for (const [query, field] of cases) {
      const response = await ana.client
        .get(`/balance-projections${query}`)
        .expect(422);
      expect(response.body.error.fields).toHaveProperty([field]);
    }
    await ana.client.get('/calendar?month=2026-13').expect(422);
  });

  it('otro usuario ve su calendario vacío', async () => {
    const beto = testApp.as({ sub: 'sub-beto-calendario' });
    const response = await beto.get(`/calendar?month=${nextMonth}`).expect(200);
    expect(response.body.events).toEqual([]);
  });
});
