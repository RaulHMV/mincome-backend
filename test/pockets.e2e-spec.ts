import { randomUUID } from 'node:crypto';
import { setUpUser, type UserSetup } from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Apartados (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  let pocketId: string;

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-apartados', { debitBalance: 5000 });
  });

  afterAll(() => testApp.close());

  async function debitBalance(): Promise<number> {
    const accounts = await ana.client.get('/accounts').expect(200);
    return accounts.body.find(
      (account: { id: string }) => account.id === ana.debitId,
    ).balance;
  }

  function movement(body: Record<string, unknown>, query = '') {
    return ana.client
      .post(`/pockets/${pocketId}/movements${query}`)
      .set('Idempotency-Key', randomUUID())
      .send({ accountId: ana.debitId, ...body });
  }

  it('crea un apartado con asignación inicial desde la cuenta elegida (D15)', async () => {
    const response = await ana.client
      .post('/pockets')
      .send({
        name: 'Vacaciones en Oaxaca',
        targetAmount: 4500,
        icon: 'travel',
        initialAmount: 500,
        sourceAccountId: ana.debitId,
      })
      .expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'Vacaciones en Oaxaca',
      balance: 500,
      targetAmount: 4500,
      targetDate: null,
      progress: 11,
      icon: 'travel',
      colorHex: null,
      isActive: true,
      createdAt: expect.any(String),
    });
    pocketId = response.body.id;
    expect(await debitBalance()).toBe(4500);
  });

  it('valida la asignación inicial', async () => {
    const tooMuch = await ana.client
      .post('/pockets')
      .send({
        name: 'Grande',
        targetAmount: 100,
        initialAmount: 200,
        sourceAccountId: ana.debitId,
      })
      .expect(422);
    expect(tooMuch.body.error.fields).toHaveProperty('initialAmount');
    const noSource = await ana.client
      .post('/pockets')
      .send({ name: 'Sin origen', targetAmount: 100, initialAmount: 50 })
      .expect(422);
    expect(noSource.body.error.fields).toHaveProperty('sourceAccountId');
    const noFunds = await ana.client
      .post('/pockets')
      .send({
        name: 'Sin saldo',
        targetAmount: 10_000,
        initialAmount: 9000,
        sourceAccountId: ana.debitId,
      })
      .expect(409);
    expect(noFunds.body.error).toMatchObject({
      code: 'insufficient_funds',
      fields: { initialAmount: expect.any(String) },
    });
  });

  it('no repite el nombre entre los activos, sin distinguir mayúsculas', async () => {
    await ana.client
      .post('/pockets')
      .send({ name: 'VACACIONES EN OAXACA', targetAmount: 100 })
      .expect(409);
  });

  it('abona y retira, y regresa el apartado con su saldo nuevo', async () => {
    const deposit = await movement({
      type: 'deposit',
      amount: 1000,
      note: 'Quincena',
    }).expect(201);
    expect(deposit.body).toEqual({
      movement: {
        id: expect.any(String),
        pocketId,
        type: 'deposit',
        amount: 1000,
        date: expect.any(String),
        note: 'Quincena',
        account: { id: ana.debitId, name: 'Nómina', type: 'debit' },
        createdAt: expect.any(String),
      },
      pocket: expect.objectContaining({ balance: 1500, progress: 33 }),
    });

    const withdrawal = await movement({
      type: 'withdrawal',
      amount: 200,
    }).expect(201);
    expect(withdrawal.body.pocket.balance).toBe(1300);
    expect(await debitBalance()).toBe(4500 - 1000 + 200);
  });

  it('no abona más del saldo de la cuenta ni retira más del saldo del apartado', async () => {
    const deposit = await movement({ type: 'deposit', amount: 99_999 }).expect(
      409,
    );
    expect(deposit.body.error.code).toBe('insufficient_funds');
    const withdrawal = await movement({
      type: 'withdrawal',
      amount: 1300.01,
    }).expect(409);
    expect(withdrawal.body.error).toMatchObject({
      code: 'insufficient_funds',
      fields: { amount: 'Es mayor al saldo del apartado' },
    });
  });

  it('?dryRun=true calcula el saldo nuevo sin guardar', async () => {
    const preview = await ana.client
      .post(`/pockets/${pocketId}/movements?dryRun=true`)
      .send({ type: 'deposit', amount: 100, accountId: ana.debitId })
      .expect(200);
    expect(preview.body.movement.id).toBeNull();
    expect(preview.body.pocket.balance).toBe(1400);
    const pockets = await ana.client.get('/pockets').expect(200);
    expect(pockets.body[0].balance).toBe(1300);
  });

  it('lista los movimientos del apartado, el más reciente primero', async () => {
    const page = await ana.client
      .get(`/pockets/${pocketId}/movements?pageSize=2`)
      .expect(200);
    expect(page.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(
      page.body.items.map((item: { type: string; amount: number }) => [
        item.type,
        item.amount,
      ]),
    ).toEqual([
      ['withdrawal', 200],
      ['deposit', 1000],
    ]);
  });

  it('libera el apartado: regresa todo a la cuenta y lo cierra (D7)', async () => {
    const before = await debitBalance();
    const released = await ana.client
      .post(`/pockets/${pocketId}/release`)
      .send({ destinationAccountId: ana.debitId })
      .expect(200);
    expect(released.body).toMatchObject({ isActive: false, balance: 0 });
    expect(await debitBalance()).toBe(before + 1300);

    await ana.client
      .patch(`/pockets/${pocketId}`)
      .send({ name: 'Otro' })
      .expect(409);
    await movement({ type: 'deposit', amount: 1 }).expect(409);
    await ana.client
      .post(`/pockets/${pocketId}/release`)
      .send({ destinationAccountId: ana.debitId })
      .expect(409);

    // El nombre queda libre para un apartado nuevo.
    await ana.client
      .post('/pockets')
      .send({ name: 'Vacaciones en Oaxaca', targetAmount: 100 })
      .expect(201);
  });

  it('máximo 10 apartados activos', async () => {
    const active = (await ana.client.get('/pockets?isActive=true').expect(200))
      .body.length;
    for (let index = active; index < 10; index++) {
      await ana.client
        .post('/pockets')
        .send({ name: `Meta ${index}`, targetAmount: 100 })
        .expect(201);
    }
    const eleventh = await ana.client
      .post('/pockets')
      .send({ name: 'Meta 11', targetAmount: 100 })
      .expect(409);
    expect(eleventh.body.error.code).toBe('conflict');
  });

  it('otro usuario recibe 404', async () => {
    const beto = testApp.as({ sub: 'sub-beto-apartados' });
    await beto.get(`/pockets/${pocketId}/movements`).expect(404);
    await beto.patch(`/pockets/${pocketId}`).send({ name: 'Mío' }).expect(404);
  });
});
