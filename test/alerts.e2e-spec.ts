import { addDays, dayOf } from '../src/common/dates';
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

/** El primer desplazamiento cuyo día del mes existe en todos los meses (≤ 28). */
function offsetWithSafeDay(offsets: number[]): number {
  const offset = offsets.find(
    (candidate) => dayOf(addDays(today(), candidate)) <= 28,
  );
  if (offset === undefined) {
    throw new Error('No safe day found');
  }
  return offset;
}

describe('Alertas (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  let cardId: string;
  let pocketId: string;
  const daysToPay = offsetWithSafeDay([3, 4, 5, 6]);
  const daysSinceCutoff = offsetWithSafeDay([-10, -11, -12, -13]);

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-alertas', { debitBalance: 10_000 });
    await ana.client
      .put(`/budgets?month=${currentMonth()}`)
      .send([
        { categoryId: CATEGORY.FOOD, limit: 100 },
        { categoryId: CATEGORY.TRANSPORT, limit: 50 },
      ])
      .expect(200);
    await postTransaction(
      ana.client,
      expense(ana.debitId, 85, { categoryId: CATEGORY.FOOD }),
    ).expect(201);
    await postTransaction(
      ana.client,
      expense(ana.debitId, 60, { categoryId: CATEGORY.TRANSPORT }),
    ).expect(201);
    // Su último corte ya pasó y el pago vence en unos días: hay que pagar la deuda.
    cardId = (
      await ana.client
        .post('/cards')
        .send({
          alias: 'BBVA Oro',
          bank: 'BBVA',
          last4: '4821',
          type: 'credit',
          creditLimit: 7000,
          cutoffDay: dayOf(addDays(today(), daysSinceCutoff)),
          dueDay: dayOf(addDays(today(), daysToPay)),
          initialDebt: 1650,
        })
        .expect(201)
    ).body.id;
    pocketId = (
      await ana.client
        .post('/pockets')
        .send({
          name: 'Vacaciones',
          targetAmount: 1000,
          targetDate: addDays(today(), 20),
          initialAmount: 400,
          sourceAccountId: ana.debitId,
          icon: 'travel',
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => testApp.close());

  const alerts = async () => (await ana.client.get('/alerts').expect(200)).body;

  it('calcula las tres clases de alerta, lo más urgente primero', async () => {
    const body = await alerts();
    expect(body).toEqual([
      {
        id: `cardPayment:${cardId}:${addDays(today(), daysToPay)}`,
        type: 'cardPayment',
        isRead: false,
        dueDate: addDays(today(), daysToPay),
        daysLeft: daysToPay,
        amount: 1650,
        card: { id: cardId, alias: 'BBVA Oro', last4: '4821', type: 'credit' },
      },
      expect.objectContaining({
        type: 'budget',
        isRead: false,
        alertLevel: 'exceeded',
        percentage: 120,
        category: { id: CATEGORY.TRANSPORT, name: 'Transporte', icon: 'car' },
      }),
      expect.objectContaining({
        type: 'budget',
        alertLevel: 'warning',
        percentage: 85,
      }),
      {
        id: `pocketGoal:${pocketId}`,
        type: 'pocketGoal',
        isRead: false,
        targetDate: addDays(today(), 20),
        daysLeft: 20,
        progress: 40,
        pocket: { id: pocketId, name: 'Vacaciones', icon: 'travel' },
      },
    ]);
    expect(body[1].id).toMatch(
      new RegExp(`^budget:[0-9a-f-]+:${currentMonth()}$`),
    );
  });

  it('marca como leída y lo recuerda', async () => {
    const [payment] = await alerts();
    const marked = await ana.client
      .patch(`/alerts/${encodeURIComponent(payment.id)}`)
      .send({ isRead: true })
      .expect(200);
    expect(marked.body).toEqual({ ...payment, isRead: true });
    expect((await alerts())[0].isRead).toBe(true);

    await ana.client
      .patch(`/alerts/${encodeURIComponent(payment.id)}`)
      .send({ isRead: false })
      .expect(200);
    expect((await alerts())[0].isRead).toBe(false);
  });

  it('un presupuesto leído en preventiva vuelve a salir sin leer cuando se excede', async () => {
    const warning = (await alerts()).find(
      (alert: { alertLevel?: string }) => alert.alertLevel === 'warning',
    );
    await ana.client
      .patch(`/alerts/${encodeURIComponent(warning.id)}`)
      .send({ isRead: true })
      .expect(200);
    expect(
      (await alerts()).find((alert: { id: string }) => alert.id === warning.id)
        .isRead,
    ).toBe(true);

    await postTransaction(
      ana.client,
      expense(ana.debitId, 20, { categoryId: CATEGORY.FOOD }),
    ).expect(201);
    const escalated = (await alerts()).find(
      (alert: { id: string }) => alert.id === warning.id,
    );
    expect(escalated).toMatchObject({
      alertLevel: 'exceeded',
      percentage: 105,
      isRead: false,
    });
  });

  it('una alerta que ya no aplica no se puede marcar', async () => {
    await ana.client
      .patch(`/alerts/${encodeURIComponent(`pocketGoal:${pocketId}`)}`)
      .send({ isRead: true })
      .expect(200);
    // Cumplir la meta quita la alerta.
    await ana.client
      .post(`/pockets/${pocketId}/movements`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ type: 'deposit', amount: 600, accountId: ana.debitId })
      .expect(201);
    expect(
      (await alerts()).some(
        (alert: { type: string }) => alert.type === 'pocketGoal',
      ),
    ).toBe(false);
    await ana.client
      .patch(`/alerts/${encodeURIComponent(`pocketGoal:${pocketId}`)}`)
      .send({ isRead: true })
      .expect(404);
    await ana.client
      .patch('/alerts/inventada')
      .send({ isRead: true })
      .expect(404);
  });

  it('valida el cuerpo y no deja ver ni marcar las de otro usuario', async () => {
    const [payment] = await alerts();
    const invalid = await ana.client
      .patch(`/alerts/${encodeURIComponent(payment.id)}`)
      .send({ isRead: 'sí' })
      .expect(422);
    expect(invalid.body.error.fields).toHaveProperty('isRead');

    const beto = testApp.as({ sub: 'sub-beto-alertas' });
    expect((await beto.get('/alerts').expect(200)).body).toEqual([]);
    await beto
      .patch(`/alerts/${encodeURIComponent(payment.id)}`)
      .send({ isRead: true })
      .expect(404);
  });
});
