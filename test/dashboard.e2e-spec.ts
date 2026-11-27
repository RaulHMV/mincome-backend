import {
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
} from '../src/common/dates';
import {
  CATEGORY,
  currentMonth,
  expense,
  postTransaction,
  setUpUser,
  today,
  type UserSetup,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('GET /dashboard (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  const previousMonth = addMonths(currentMonth(), -1);

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-dashboard', {
      debitBalance: 10_000,
      initialBalanceDate: firstDayOfMonth(previousMonth),
    });
    // El mes pasado: un gasto.
    await postTransaction(
      ana.client,
      expense(ana.debitId, 300, {
        date: lastDayOfMonth(previousMonth),
        concept: 'Gasolina',
      }),
    ).expect(201);
    // Este mes: nómina, súper, una tarjeta con deuda y dos apartados.
    await postTransaction(ana.client, {
      type: 'income',
      subtype: 'variable',
      categoryId: CATEGORY.PAYROLL,
      amount: 5000,
      date: today(),
      concept: 'Nómina quincenal',
      paymentMethod: 'transfer',
      accountId: ana.debitId,
    }).expect(201);
    await ana.client
      .put(`/budgets?month=${currentMonth()}`)
      .send([{ categoryId: CATEGORY.FOOD, limit: 1500 }])
      .expect(200);
    await postTransaction(
      ana.client,
      expense(ana.debitId, 1260, {
        categoryId: CATEGORY.FOOD,
        concept: 'Súper',
      }),
    ).expect(201);
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
        initialDebt: 2450,
      })
      .expect(201);
    await ana.client
      .post('/pockets')
      .send({
        name: 'Fondo',
        targetAmount: 1000,
        initialAmount: 500,
        sourceAccountId: ana.debitId,
      })
      .expect(201);
    await ana.client
      .post('/pockets')
      .send({
        name: 'Meta cumplida',
        targetAmount: 100,
        initialAmount: 100,
        sourceAccountId: ana.debitId,
      })
      .expect(201);
  });

  afterAll(() => testApp.close());

  it('resume el mes actual con las mismas fórmulas que las demás pantallas', async () => {
    const { body } = await ana.client.get('/dashboard').expect(200);
    // Saldo Libre: 10,000 − 300 + 5,000 − 1,260 − 500 − 100.
    // Patrimonio (D2): 12,840 + 600 de apartados − 2,450 de deuda, que es lo
    // mismo que saldos iniciales (10,000 − 2,450) + ingresos − gastos.
    expect(body).toMatchObject({
      month: currentMonth(),
      summary: {
        netWorth: 10_990,
        freeBalance: 12_840,
        pocketsBalance: 600,
        pocketsInProgress: 1,
        monthExpense: 1260,
        monthIncome: 5000,
      },
      credit: { used: 2450, limit: 7000 },
      netWorthHistory: [
        { month: previousMonth, netWorth: 9700 },
        { month: currentMonth(), netWorth: 10_990 },
      ],
    });
    expect(body.budgets).toEqual([
      expect.objectContaining({
        spent: 1260,
        percentage: 84,
        alertLevel: 'warning',
      }),
    ]);
    expect(
      body.recentMovements.map(
        (movement: { kind: string; title: string }) =>
          `${movement.kind}:${movement.title}`,
      ),
    ).toEqual([
      'pocketDeposit:Meta cumplida',
      'pocketDeposit:Fondo',
      'expense:Súper',
    ]);
  });

  it('un mes cerrado se mide en su último día', async () => {
    const { body } = await ana.client
      .get(`/dashboard?month=${previousMonth}`)
      .expect(200);
    expect(body).toMatchObject({
      month: previousMonth,
      summary: {
        netWorth: 9700,
        freeBalance: 9700,
        pocketsBalance: 0,
        monthExpense: 300,
        monthIncome: 0,
      },
      netWorthHistory: [{ month: previousMonth, netWorth: 9700 }],
    });
    expect(
      body.recentMovements.map((movement: { title: string }) => movement.title),
    ).toEqual(['Gasolina']);
  });

  it('un usuario nuevo ve ceros y un solo mes de historia, sin rellenar', async () => {
    const nuevo = testApp.as({ sub: 'sub-nuevo-dashboard' });
    const { body } = await nuevo.get('/dashboard').expect(200);
    expect(body).toEqual({
      month: currentMonth(),
      summary: {
        netWorth: 0,
        freeBalance: 0,
        pocketsBalance: 0,
        pocketsInProgress: 0,
        monthExpense: 0,
        monthIncome: 0,
      },
      credit: { used: 0, limit: 0 },
      netWorthHistory: [{ month: currentMonth(), netWorth: 0 }],
      budgets: [],
      recentMovements: [],
    });
  });

  it('valida el mes', async () => {
    const response = await ana.client
      .get('/dashboard?month=2026-1')
      .expect(422);
    expect(response.body.error.fields).toHaveProperty('month');
  });
});
