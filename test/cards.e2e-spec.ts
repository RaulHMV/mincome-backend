import { randomUUID } from 'node:crypto';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Mis Tarjetas (e2e)', () => {
  let testApp: TestApp;
  const ana = { sub: 'sub-ana-tarjetas', name: 'Ana' };
  let payrollId: string;
  let creditCardId: string;
  let creditAccountId: string;

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    const payroll = await testApp
      .as(ana)
      .post('/accounts')
      .send({ name: 'Nómina', type: 'debit', initialBalance: 5200 })
      .expect(201);
    payrollId = payroll.body.id;
  });

  afterAll(() => testApp.close());

  it('da de alta una tarjeta de crédito con su cuenta y su deuda inicial', async () => {
    const response = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'BBVA Oro',
        bank: 'BBVA',
        last4: '4821',
        type: 'credit',
        colorHex: '#202B33',
        creditLimit: 7000,
        cutoffDay: 12,
        dueDay: 2,
        initialDebt: 1650,
      })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      alias: 'BBVA Oro',
      bank: 'BBVA',
      last4: '4821',
      type: 'credit',
      colorHex: '#202B33',
      isActive: true,
      accountId: expect.any(String),
      createdAt: expect.any(String),
      creditLimit: 7000,
      cutoffDay: 12,
      dueDay: 2,
      usedCredit: 1650,
      availableCredit: 5350,
      nextCutoffDate: expect.stringMatching(/^\d{4}-\d{2}-12$/),
      nextDueDate: expect.stringMatching(/^\d{4}-\d{2}-02$/),
      paymentToAvoidInterest: 1650,
      balance: null,
    });
    creditCardId = response.body.id;
    creditAccountId = response.body.accountId;

    const accounts = await testApp.as(ana).get('/accounts').expect(200);
    expect(accounts.body).toContainEqual(
      expect.objectContaining({
        id: creditAccountId,
        name: 'BBVA Oro',
        type: 'credit',
        balance: -1650,
      }),
    );
  });

  it('liga una tarjeta de débito a una cuenta existente', async () => {
    const response = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'Nómina Santander',
        bank: 'Santander',
        last4: '7712',
        type: 'debit',
        accountId: payrollId,
      })
      .expect(201);
    expect(response.body).toMatchObject({
      type: 'debit',
      accountId: payrollId,
      creditLimit: null,
      cutoffDay: null,
      usedCredit: null,
      balance: 5200,
    });

    const accounts = await testApp.as(ana).get('/accounts').expect(200);
    const payroll = accounts.body.find(
      (account: { id: string }) => account.id === payrollId,
    );
    expect(payroll.cards).toEqual([
      {
        id: response.body.id,
        alias: 'Nómina Santander',
        last4: '7712',
        type: 'debit',
      },
    ]);
  });

  it('crea una cuenta de débito nueva cuando no se indica una', async () => {
    const response = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'Nu Débito',
        bank: 'Nu México',
        last4: '1111',
        type: 'debit',
        initialBalance: 300,
      })
      .expect(201);
    expect(response.body.balance).toBe(300);
    expect(response.body.accountId).not.toBe(payrollId);
  });

  it('no repite alias ni banco + terminación entre tarjetas activas', async () => {
    const duplicatedAlias = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'bbva oro',
        bank: 'Otro',
        last4: '0000',
        type: 'credit',
        creditLimit: 1,
        cutoffDay: 1,
        dueDay: 2,
      })
      .expect(409);
    expect(duplicatedAlias.body.error.fields).toEqual({
      alias: expect.any(String),
    });

    const duplicatedLast4 = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'Otra',
        bank: 'bbva',
        last4: '4821',
        type: 'credit',
        creditLimit: 1,
        cutoffDay: 1,
        dueDay: 2,
      })
      .expect(409);
    expect(duplicatedLast4.body.error.fields).toEqual({
      last4: expect.any(String),
    });
  });

  it('RNF3: rechaza CVV, NIP, número completo o un alias que parece número de tarjeta', async () => {
    const base = { bank: 'BBVA', type: 'debit', initialBalance: 0 };
    await testApp
      .as(ana)
      .post('/cards')
      .send({ ...base, alias: 'X', last4: '1234', cvv: '123' })
      .expect(422);
    await testApp
      .as(ana)
      .post('/cards')
      .send({ ...base, alias: 'X', last4: '4152313800001234' })
      .expect(422);
    const alias = await testApp
      .as(ana)
      .post('/cards')
      .send({ ...base, alias: '4152 3138 0000 1234', last4: '1234' })
      .expect(422);
    expect(alias.body.error.fields.alias).toContain('número');
  });

  it('valida que el día de pago sea distinto al de corte', async () => {
    const response = await testApp
      .as(ana)
      .post('/cards')
      .send({
        alias: 'Mala',
        bank: 'X',
        last4: '2222',
        type: 'credit',
        creditLimit: 100,
        cutoffDay: 5,
        dueDay: 5,
      })
      .expect(422);
    expect(response.body.error.fields).toEqual({
      dueDay: 'Debe ser distinto al día de corte',
    });
  });

  describe('POST /cards/:cardId/payments', () => {
    it('pide Idempotency-Key', async () => {
      const response = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .send({ amount: 100, sourceAccountId: payrollId })
        .expect(422);
      expect(response.body.error.fields).toHaveProperty(['Idempotency-Key']);
    });

    it('registra el pago como traspaso y un reintento con la misma llave no paga dos veces', async () => {
      const key = randomUUID();
      const first = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', key)
        .send({ amount: 650, sourceAccountId: payrollId })
        .expect(201);
      expect(first.body).toEqual({
        id: expect.any(String),
        sourceAccount: { id: payrollId, name: 'Nómina', type: 'debit' },
        destinationAccount: {
          id: creditAccountId,
          name: 'BBVA Oro',
          type: 'credit',
        },
        amount: 650,
        date: expect.any(String),
        note: null,
        createdAt: expect.any(String),
      });

      const retry = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', key)
        .send({ amount: 650, sourceAccountId: payrollId })
        .expect(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');

      const [{ total }] = await testApp.dataSource.query(
        'SELECT count(*)::int AS total FROM traspasos WHERE cuenta_destino_id = $1',
        [creditAccountId],
      );
      expect(total).toBe(1);

      const card = (await testApp.as(ana).get('/cards?type=credit').expect(200))
        .body[0];
      expect(card).toMatchObject({
        usedCredit: 1000,
        availableCredit: 6000,
        paymentToAvoidInterest: 1000,
      });
      const payroll = (
        await testApp.as(ana).get('/accounts').expect(200)
      ).body.find((account: { id: string }) => account.id === payrollId);
      expect(payroll.balance).toBe(4550);
    });

    it('la misma llave con otro cuerpo se rechaza', async () => {
      const key = randomUUID();
      await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', key)
        .send({ amount: 1, sourceAccountId: payrollId })
        .expect(201);
      const reused = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', key)
        .send({ amount: 2, sourceAccountId: payrollId })
        .expect(422);
      expect(reused.body.error.code).toBe('idempotency_key_reused');
    });

    it('no paga más que la deuda ni más que el saldo de la cuenta de origen', async () => {
      const moreThanDebt = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 5000, sourceAccountId: payrollId })
        .expect(409);
      expect(moreThanDebt.body.error.code).toBe('insufficient_funds');

      const [cash] = (await testApp.as(ana).get('/accounts').expect(200)).body;
      const moreThanBalance = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 10, sourceAccountId: cash.id })
        .expect(409);
      expect(moreThanBalance.body.error).toMatchObject({
        code: 'insufficient_funds',
        fields: { amount: expect.any(String) },
      });
    });

    it('solo se pagan tarjetas de crédito, desde efectivo o débito', async () => {
      const debit = (await testApp.as(ana).get('/cards?type=debit').expect(200))
        .body[0];
      await testApp
        .as(ana)
        .post(`/cards/${debit.id}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 10, sourceAccountId: payrollId })
        .expect(422);
      const fromCredit = await testApp
        .as(ana)
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 10, sourceAccountId: creditAccountId })
        .expect(422);
      expect(fromCredit.body.error.fields).toHaveProperty('sourceAccountId');
    });
  });

  describe('DELETE /cards/:cardId (D16)', () => {
    it('borra una tarjeta sin movimientos', async () => {
      const card = await testApp
        .as(ana)
        .post('/cards')
        .send({
          alias: 'Temporal',
          bank: 'HSBC',
          last4: '3333',
          type: 'credit',
          creditLimit: 500,
          cutoffDay: 3,
          dueDay: 23,
        })
        .expect(201);
      await testApp.as(ana).delete(`/cards/${card.body.id}`).expect(204);
      const all = await testApp.as(ana).get('/cards').expect(200);
      expect(all.body.map((c: { id: string }) => c.id)).not.toContain(
        card.body.id,
      );
      const accounts = await testApp
        .as(ana)
        .get('/accounts?includeInactive=true')
        .expect(200);
      expect(accounts.body.map((a: { id: string }) => a.id)).not.toContain(
        card.body.accountId,
      );
    });

    it('desactiva una tarjeta con movimientos, junto con su cuenta de crédito', async () => {
      await testApp.as(ana).delete(`/cards/${creditCardId}`).expect(204);
      const active = await testApp
        .as(ana)
        .get('/cards?isActive=true')
        .expect(200);
      expect(active.body.map((c: { id: string }) => c.id)).not.toContain(
        creditCardId,
      );
      const inactive = await testApp
        .as(ana)
        .get('/cards?isActive=false')
        .expect(200);
      expect(inactive.body).toEqual([
        expect.objectContaining({
          id: creditCardId,
          isActive: false,
          usedCredit: 999,
        }),
      ]);

      // Su alias queda libre para otra tarjeta activa.
      await testApp
        .as(ana)
        .post('/cards')
        .send({
          alias: 'BBVA Oro',
          bank: 'BBVA',
          last4: '4821',
          type: 'credit',
          creditLimit: 9000,
          cutoffDay: 12,
          dueDay: 2,
        })
        .expect(201);
    });
  });
});
