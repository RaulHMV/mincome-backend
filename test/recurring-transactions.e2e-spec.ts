import { addMonths, firstDayOfMonth } from '../src/common/dates';
import { RecurringTransactionsService } from '../src/recurring-transactions/recurring-transactions.service';
import {
  CATEGORY,
  currentMonth,
  setUpUser,
  today,
  type UserSetup,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Recurrentes (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  const twoMonthsAgo = addMonths(currentMonth(), -2);

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-recurrentes', {
      initialBalanceDate: `${twoMonthsAgo}-01`,
    });
  });

  afterAll(() => testApp.close());

  function rent(overrides: Record<string, unknown> = {}) {
    return {
      type: 'expense',
      subtype: 'fixed',
      categoryId: CATEGORY.HOME,
      amount: 3200,
      concept: 'Renta departamento',
      paymentMethod: 'transfer',
      accountId: ana.debitId,
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: firstDayOfMonth(twoMonthsAgo),
      endDate: null,
      ...overrides,
    };
  }

  async function countGenerated(
    recurringTransactionId: string,
  ): Promise<number> {
    const [{ total }] = await testApp.dataSource.query(
      'SELECT count(*)::int AS total FROM transacciones WHERE recurrente_id = $1',
      [recurringTransactionId],
    );
    return total;
  }

  it('genera al crear las ocurrencias que ya tocaban (§3.7)', async () => {
    const response = await ana.client
      .post('/recurring-transactions')
      .send(rent())
      .expect(201);

    expect(response.body.recurringTransaction).toEqual({
      id: expect.any(String),
      type: 'expense',
      subtype: 'fixed',
      amount: 3200,
      concept: 'Renta departamento',
      paymentMethod: 'transfer',
      category: { id: 6, name: 'Hogar', icon: 'house' },
      account: { id: ana.debitId, name: 'Nómina', type: 'debit' },
      card: null,
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: firstDayOfMonth(twoMonthsAgo),
      endDate: null,
      nextRunDate: firstDayOfMonth(addMonths(currentMonth(), 1)),
      isActive: true,
      createdAt: expect.any(String),
    });
    expect(
      response.body.generatedTransactions.map((t: { date: string }) => t.date),
    ).toEqual([
      firstDayOfMonth(twoMonthsAgo),
      firstDayOfMonth(addMonths(currentMonth(), -1)),
      firstDayOfMonth(currentMonth()),
    ]);
    expect(response.body.generatedTransactions[0]).toMatchObject({
      recurringTransactionId: response.body.recurringTransaction.id,
      subtype: 'fixed',
      amount: 3200,
    });
  });

  it('una que empieza en el futuro no genera nada todavía', async () => {
    const start = firstDayOfMonth(addMonths(currentMonth(), 2));
    const response = await ana.client
      .post('/recurring-transactions')
      .send(rent({ concept: 'Gimnasio', amount: 500, startDate: start }))
      .expect(201);
    expect(response.body.generatedTransactions).toEqual([]);
    expect(response.body.recurringTransaction.nextRunDate).toBe(start);
  });

  it('el proceso diario no duplica y alcanza los días que no corrió', async () => {
    const created = await ana.client
      .post('/recurring-transactions')
      .send(rent({ concept: 'Internet', amount: 400, dayOfMonth: 5 }))
      .expect(201);
    const id = created.body.recurringTransaction.id;
    const generatedAtCreation = await countGenerated(id);

    const job = testApp.app.get(RecurringTransactionsService);
    await job.generateAllDue();
    await job.generateAllDue();
    expect(await countGenerated(id)).toBe(generatedAtCreation);

    // Como si proxima_ejecucion se hubiera quedado atrás: vuelve a pasar por
    // ocurrencias que ya existen y no las duplica.
    await testApp.dataSource.query(
      'UPDATE transacciones_recurrentes SET proxima_ejecucion = fecha_inicio WHERE id = $1',
      [id],
    );
    const summary = await job.generateAllDue();
    expect(summary.failures).toBe(0);
    expect(await countGenerated(id)).toBe(generatedAtCreation);

    const [{ next }] = await testApp.dataSource.query(
      'SELECT proxima_ejecucion::text AS next FROM transacciones_recurrentes WHERE id = $1',
      [id],
    );
    expect(next > today()).toBe(true);
  });

  it('pausa y reanuda: pausada no tiene siguiente ocurrencia', async () => {
    const created = await ana.client
      .post('/recurring-transactions')
      .send(
        rent({
          concept: 'Streaming',
          amount: 199,
          startDate: today(),
          dayOfMonth: Number(today().slice(8, 10)),
        }),
      )
      .expect(201);
    const id = created.body.recurringTransaction.id;

    const paused = await ana.client
      .patch(`/recurring-transactions/${id}`)
      .send({ isActive: false })
      .expect(200);
    expect(paused.body).toMatchObject({ isActive: false, nextRunDate: null });

    const resumed = await ana.client
      .patch(`/recurring-transactions/${id}`)
      .send({ isActive: true })
      .expect(200);
    expect(resumed.body.isActive).toBe(true);
    expect(resumed.body.nextRunDate > today()).toBe(true);
    expect(await countGenerated(id)).toBe(1);
  });

  it('termina con endDate', async () => {
    const created = await ana.client
      .post('/recurring-transactions')
      .send(
        rent({
          concept: 'Curso',
          amount: 900,
          startDate: today(),
          dayOfMonth: 28,
        }),
      )
      .expect(201);
    const response = await ana.client
      .patch(`/recurring-transactions/${created.body.recurringTransaction.id}`)
      .send({ endDate: today() })
      .expect(200);
    expect(response.body).toMatchObject({ endDate: today(), isActive: false });
    expect(response.body.nextRunDate).toBeNull();
  });

  it('quincenal: genera el 15 y el último día', async () => {
    const response = await ana.client
      .post('/recurring-transactions')
      .send({
        type: 'income',
        subtype: 'recurring',
        categoryId: CATEGORY.PAYROLL,
        amount: 5000,
        concept: 'Nómina quincenal',
        paymentMethod: 'transfer',
        accountId: ana.debitId,
        frequency: 'semimonthly',
        startDate: firstDayOfMonth(addMonths(currentMonth(), -1)),
      })
      .expect(201);
    const dates = response.body.generatedTransactions.map(
      (t: { date: string }) => t.date.slice(8, 10),
    );
    expect(dates.slice(0, 2)).toEqual([
      '15',
      expect.stringMatching(/^(28|29|30|31)$/),
    ]);
  });

  it.each([
    ['mensual sin día', { dayOfMonth: null }, 'dayOfMonth'],
    [
      'día en una frecuencia que no es mensual',
      { frequency: 'weekly' },
      'dayOfMonth',
    ],
    ['subtipo variable', { subtype: 'variable' }, 'subtype'],
    ['fin antes del inicio', { endDate: '2020-01-01' }, 'endDate'],
  ])('rechaza %s', async (_name, overrides, field) => {
    const response = await ana.client
      .post('/recurring-transactions')
      .send(rent(overrides))
      .expect(422);
    expect(response.body.error.fields).toHaveProperty([field]);
  });

  it('no se cambia la frecuencia ni el inicio', async () => {
    const [template] = (
      await ana.client.get('/recurring-transactions?isActive=true').expect(200)
    ).body;
    await ana.client
      .patch(`/recurring-transactions/${template.id}`)
      .send({ frequency: 'weekly' })
      .expect(422);
  });

  it('desactivar la tarjeta pausa sus recurrentes', async () => {
    const card = await ana.client
      .post('/cards')
      .send({
        alias: 'Nu',
        bank: 'Nu México',
        last4: '3306',
        type: 'credit',
        creditLimit: 5000,
        cutoffDay: 20,
        dueDay: 10,
      })
      .expect(201);
    const created = await ana.client
      .post('/recurring-transactions')
      .send(
        rent({
          concept: 'Spotify',
          amount: 129,
          paymentMethod: 'card',
          cardId: card.body.id,
          accountId: null,
          startDate: today(),
          dayOfMonth: Number(today().slice(8, 10)),
        }),
      )
      .expect(201);
    await ana.client.delete(`/cards/${card.body.id}`).expect(204);
    const list = await ana.client.get('/recurring-transactions').expect(200);
    const spotify = list.body.find(
      (r: { id: string }) => r.id === created.body.recurringTransaction.id,
    );
    expect(spotify).toMatchObject({ isActive: false });
  });
});
