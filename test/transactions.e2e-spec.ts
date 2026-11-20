import { randomUUID } from 'node:crypto';
import {
  CATEGORY,
  currentMonth,
  expense,
  postTransaction,
  previousMonth,
  setUpUser,
  today,
  type UserSetup,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Transacciones y presupuestos (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-transacciones');
  });

  afterAll(() => testApp.close());

  describe('PUT y GET /budgets', () => {
    it('crea presupuestos del mes con umbral por defecto de 80', async () => {
      const response = await ana.client
        .put(`/budgets?month=${currentMonth()}`)
        .send([
          { categoryId: CATEGORY.TRANSPORT, limit: 800 },
          { categoryId: CATEGORY.FOOD, limit: 1500, alertThreshold: 85 },
        ])
        .expect(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          {
            id: expect.any(String),
            category: { id: 4, name: 'Transporte', icon: 'car' },
            limit: 800,
            alertThreshold: 80,
            spent: 0,
            percentage: 0,
            alertLevel: 'none',
            isActive: true,
            effectiveFrom: `${currentMonth()}-01`,
          },
          expect.objectContaining({
            category: expect.objectContaining({ id: 1 }),
            alertThreshold: 85,
          }),
        ]),
      );
    });

    it('pide el límite al crear y no acepta categorías de ingreso', async () => {
      const noLimit = await ana.client
        .put('/budgets')
        .send([{ categoryId: CATEGORY.HOME }])
        .expect(422);
      expect(noLimit.body.error.fields).toEqual({
        '0.limit': 'Es obligatorio al crear el presupuesto',
      });

      const income = await ana.client
        .put('/budgets')
        .send([{ categoryId: CATEGORY.PAYROLL, limit: 100 }])
        .expect(422);
      expect(income.body.error.fields).toHaveProperty(['0.categoryId']);
    });

    it('cambiar el límite este mes no reescribe el mes anterior (§2.5)', async () => {
      await ana.client
        .put(`/budgets?month=${previousMonth()}`)
        .send([{ categoryId: CATEGORY.SERVICES, limit: 900 }])
        .expect(200);
      await ana.client
        .put(`/budgets?month=${currentMonth()}`)
        .send([{ categoryId: CATEGORY.SERVICES, limit: 1200 }])
        .expect(200);

      const previous = await ana.client
        .get(`/budgets?month=${previousMonth()}`)
        .expect(200);
      const current = await ana.client
        .get(`/budgets?month=${currentMonth()}`)
        .expect(200);
      const services = (
        budgets: { category: { id: number }; limit: number }[],
      ) =>
        budgets.find((budget) => budget.category.id === CATEGORY.SERVICES)
          ?.limit;
      expect(services(previous.body)).toBe(900);
      expect(services(current.body)).toBe(1200);
    });

    it('quita un presupuesto desde el mes indicado', async () => {
      const response = await ana.client
        .put(`/budgets?month=${currentMonth()}`)
        .send([{ categoryId: CATEGORY.SERVICES, isActive: false }])
        .expect(200);
      expect(
        response.body.map((b: { category: { id: number } }) => b.category.id),
      ).not.toContain(CATEGORY.SERVICES);
      const previous = await ana.client
        .get(`/budgets?month=${previousMonth()}`)
        .expect(200);
      expect(
        previous.body.map((b: { category: { id: number } }) => b.category.id),
      ).toContain(CATEGORY.SERVICES);
    });
  });

  describe('POST /transactions y nivel_alerta (§3.3, D4)', () => {
    it('solo el gasto que cruza un umbral guarda la alerta', async () => {
      const steps: [number, string, number][] = [
        [600, 'none', 75],
        [50, 'warning', 81],
        [100, 'none', 93],
        [70, 'exceeded', 102],
      ];
      for (const [amount, alertLevel, percentage] of steps) {
        const response = await postTransaction(
          ana.client,
          expense(ana.debitId, amount),
        ).expect(201);
        expect(response.body.transaction.alertLevel).toBe(alertLevel);
        expect(response.body.budget).toMatchObject({
          category: { id: 4 },
          percentage,
        });
      }
      const budgets = await ana.client.get('/budgets').expect(200);
      expect(budgets.body[0]).toMatchObject({
        spent: 820,
        percentage: 102,
        alertLevel: 'exceeded',
      });
    });

    it('regresa la transacción completa con la forma del contrato', async () => {
      const response = await postTransaction(
        ana.client,
        expense(ana.debitId, 85.5, {
          time: '14:20',
          merchant: 'Uber',
          notes: 'Oficina',
          categoryId: CATEGORY.HOME,
        }),
      ).expect(201);
      expect(response.body).toEqual({
        transaction: {
          id: expect.any(String),
          date: today(),
          time: '14:20',
          type: 'expense',
          subtype: 'variable',
          amount: 85.5,
          concept: 'Uber',
          merchant: 'Uber',
          notes: 'Oficina',
          paymentMethod: 'transfer',
          category: { id: 6, name: 'Hogar', icon: 'house' },
          account: { id: ana.debitId, name: 'Nómina', type: 'debit' },
          card: null,
          recurringTransactionId: null,
          alertLevel: 'none',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        budget: null,
      });
      await ana.client
        .get(`/transactions/${response.body.transaction.id}`)
        .expect(200, response.body.transaction);
    });

    it('?dryRun=true calcula sin guardar ni pedir Idempotency-Key', async () => {
      const before = await testApp.dataSource.query(
        'SELECT count(*)::int AS total FROM transacciones',
      );
      const response = await ana.client
        .post('/transactions?dryRun=true')
        .send(expense(ana.debitId, 10))
        .expect(200);
      expect(response.body.transaction).toMatchObject({
        id: null,
        amount: 10,
        alertLevel: 'none',
      });
      expect(response.body.budget).toMatchObject({ spent: 830 });
      const after = await testApp.dataSource.query(
        'SELECT count(*)::int AS total FROM transacciones',
      );
      expect(after[0].total).toBe(before[0].total);
    });

    it('un ingreso por transferencia sube el saldo de la cuenta de débito', async () => {
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
      const accounts = await ana.client.get('/accounts').expect(200);
      const debit = accounts.body.find(
        (account: { id: string }) => account.id === ana.debitId,
      );
      expect(debit.balance).toBe(10_000 - 820 - 85.5 + 5000);
    });
  });

  describe('Validaciones (§4) y disponible (D14)', () => {
    it('no deja gastar más del saldo de la cuenta', async () => {
      const response = await postTransaction(
        ana.client,
        expense(ana.cashId, 1, { paymentMethod: 'cash' }),
      ).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'insufficient_funds',
        fields: { amount: expect.any(String) },
      });
    });

    it('no deja gastar más del crédito disponible', async () => {
      const card = await ana.client
        .post('/cards')
        .send({
          alias: 'BBVA Oro',
          bank: 'BBVA',
          last4: '4821',
          type: 'credit',
          creditLimit: 1000,
          cutoffDay: 12,
          dueDay: 2,
        })
        .expect(201);
      const withCard = {
        paymentMethod: 'card',
        accountId: null,
        cardId: card.body.id,
        categoryId: CATEGORY.FOOD,
      };
      await postTransaction(
        ana.client,
        expense(ana.debitId, 900, withCard),
      ).expect(201);
      const over = await postTransaction(
        ana.client,
        expense(ana.debitId, 101, withCard),
      ).expect(409);
      expect(over.body.error.code).toBe('insufficient_funds');

      const cards = await ana.client.get('/cards?type=credit').expect(200);
      expect(cards.body[0]).toMatchObject({
        usedCredit: 900,
        availableCredit: 100,
      });
    });

    it.each([
      ['fecha futura', { date: '2999-01-01' }, 'date'],
      [
        'ingreso con tarjeta',
        {
          type: 'income',
          subtype: 'variable',
          categoryId: CATEGORY.PAYROLL,
          paymentMethod: 'card',
          cardId: randomUUID(),
          accountId: null,
        },
        'paymentMethod',
      ],
      [
        'tarjeta sin cardId',
        { paymentMethod: 'card', accountId: null },
        'cardId',
      ],
      [
        'efectivo con una cuenta de débito',
        { paymentMethod: 'cash' },
        'accountId',
      ],
      [
        'categoría de ingresos en un gasto',
        { categoryId: CATEGORY.PAYROLL },
        'categoryId',
      ],
      ['subtipo de ingreso en un gasto', { subtype: 'recurring' }, 'subtype'],
      ['monto con 3 decimales', { amount: 10.123 }, 'amount'],
      ['cuenta de otro usuario', { accountId: randomUUID() }, 'accountId'],
    ])('rechaza %s', async (_name, overrides, field) => {
      const response = await postTransaction(
        ana.client,
        expense(ana.debitId, 10, overrides),
      ).expect(422);
      expect(response.body.error.fields).toHaveProperty([field]);
    });
  });

  describe('PATCH y DELETE /transactions/:transactionId', () => {
    it('edita el monto, recalcula el saldo y pide la cuenta al dejar la tarjeta', async () => {
      const created = await postTransaction(
        ana.client,
        expense(ana.debitId, 100, { categoryId: CATEGORY.HOME }),
      ).expect(201);
      const id = created.body.transaction.id;

      const updated = await ana.client
        .patch(`/transactions/${id}`)
        .send({ amount: 150, notes: 'Con propina' })
        .expect(200);
      expect(updated.body.transaction).toMatchObject({
        amount: 150,
        notes: 'Con propina',
      });

      // La tarjeta tiene $100 disponibles: $150 no caben, $60 sí.
      const card = (await ana.client.get('/cards?type=credit').expect(200))
        .body[0];
      const tooMuch = await ana.client
        .patch(`/transactions/${id}`)
        .send({ paymentMethod: 'card', cardId: card.id })
        .expect(409);
      expect(tooMuch.body.error.code).toBe('insufficient_funds');
      const moved = await ana.client
        .patch(`/transactions/${id}`)
        .send({ paymentMethod: 'card', cardId: card.id, amount: 60 })
        .expect(200);
      expect(moved.body.transaction.account).toMatchObject({
        type: 'credit',
        name: 'BBVA Oro',
      });
      const back = await ana.client
        .patch(`/transactions/${id}`)
        .send({ paymentMethod: 'cash' })
        .expect(422);
      expect(back.body.error.fields).toHaveProperty('accountId');
    });

    it('borra una transacción y después responde 404', async () => {
      const created = await postTransaction(
        ana.client,
        expense(ana.debitId, 5),
      ).expect(201);
      const id = created.body.transaction.id;
      await ana.client.delete(`/transactions/${id}`).expect(204);
      await ana.client.get(`/transactions/${id}`).expect(404);
      await ana.client.delete(`/transactions/${id}`).expect(404);
    });

    it('otro usuario no ve ni edita la transacción', async () => {
      const created = await postTransaction(
        ana.client,
        expense(ana.debitId, 5),
      ).expect(201);
      const beto = testApp.as({ sub: 'sub-beto-transacciones' });
      await beto
        .get(`/transactions/${created.body.transaction.id}`)
        .expect(404);
      await beto
        .patch(`/transactions/${created.body.transaction.id}`)
        .send({ amount: 1 })
        .expect(404);
    });
  });
});
