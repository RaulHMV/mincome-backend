import { randomUUID } from 'node:crypto';
import { addDays } from '../src/common/dates';
import {
  CATEGORY,
  postTransaction,
  setUpUser,
  today,
  type UserSetup,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('GET /movements (e2e)', () => {
  let testApp: TestApp;
  let ana: UserSetup;
  let creditCardId: string;
  let creditAccountId: string;
  let pocketId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    ana = await setUpUser(testApp, 'sub-ana-movimientos', {
      debitBalance: 10_000,
      initialBalanceDate: addDays(today(), -30),
    });

    ids.payroll = (
      await postTransaction(ana.client, {
        type: 'income',
        subtype: 'variable',
        categoryId: CATEGORY.PAYROLL,
        amount: 5000,
        date: addDays(today(), -10),
        concept: 'Nómina quincenal',
        paymentMethod: 'transfer',
        accountId: ana.debitId,
      }).expect(201)
    ).body.transaction.id;

    ids.groceries = (
      await postTransaction(ana.client, {
        type: 'expense',
        subtype: 'variable',
        categoryId: CATEGORY.FOOD,
        amount: 420,
        date: addDays(today(), -5),
        concept: 'Supermercado',
        merchant: 'La Comer',
        notes: 'Despensa de la semana',
        paymentMethod: 'transfer',
        accountId: ana.debitId,
      }).expect(201)
    ).body.transaction.id;

    const card = await ana.client
      .post('/cards')
      .send({
        alias: 'BBVA Oro',
        bank: 'BBVA',
        last4: '4821',
        type: 'credit',
        creditLimit: 7000,
        cutoffDay: 12,
        dueDay: 2,
      })
      .expect(201);
    creditCardId = card.body.id;
    creditAccountId = card.body.accountId;

    ids.uber = (
      await postTransaction(ana.client, {
        type: 'expense',
        subtype: 'variable',
        categoryId: CATEGORY.TRANSPORT,
        amount: 85,
        date: today(),
        time: '14:20',
        concept: 'Uber',
        paymentMethod: 'card',
        cardId: creditCardId,
      }).expect(201)
    ).body.transaction.id;

    const pocket = await ana.client
      .post('/pockets')
      .send({
        name: 'Fondo de Emergencia',
        targetAmount: 4500,
        icon: 'shield',
        initialAmount: 500,
        sourceAccountId: ana.debitId,
      })
      .expect(201);
    pocketId = pocket.body.id;
    ids.withdrawal = (
      await ana.client
        .post(`/pockets/${pocketId}/movements`)
        .set('Idempotency-Key', randomUUID())
        .send({ type: 'withdrawal', amount: 100, accountId: ana.debitId })
        .expect(201)
    ).body.movement.id;

    ids.cardPayment = (
      await ana.client
        .post(`/cards/${creditCardId}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 50, sourceAccountId: ana.debitId })
        .expect(201)
    ).body.id;
  });

  afterAll(() => testApp.close());

  async function search(query = '') {
    const response = await ana.client.get(`/movements${query}`).expect(200);
    return response.body;
  }

  const kindsOf = (page: { items: { kind: string; title: string }[] }) =>
    page.items.map((item) => `${item.kind}:${item.title}`);

  it('junta transacciones, apartados y traspasos, del más reciente al más antiguo', async () => {
    const page = await search();
    expect(kindsOf(page)).toEqual([
      'transfer:BBVA Oro',
      'pocketWithdrawal:Fondo de Emergencia',
      'pocketDeposit:Fondo de Emergencia',
      'expense:Uber',
      'expense:La Comer',
      'income:Nómina quincenal',
    ]);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 6 });
    // Los totales no cuentan traspasos (requerimientos-backend.md §3.2).
    expect(page.summary).toEqual({
      income: 5000,
      expense: 505,
      pocketDeposits: 500,
      pocketWithdrawals: 100,
      balance: 4495,
    });
  });

  it('cada tipo trae la forma del contrato', async () => {
    const page = await search();
    const byKind = (kind: string) =>
      page.items.find((item: { kind: string }) => item.kind === kind);
    const debit = { id: ana.debitId, name: 'Nómina', type: 'debit' };
    const credit = { id: creditAccountId, name: 'BBVA Oro', type: 'credit' };

    expect(byKind('expense')).toEqual({
      id: ids.uber,
      kind: 'expense',
      title: 'Uber',
      amount: 85,
      date: today(),
      time: '14:20',
      category: { id: CATEGORY.TRANSPORT, name: 'Transporte', icon: 'car' },
      icon: 'car',
      account: credit,
      card: {
        id: creditCardId,
        alias: 'BBVA Oro',
        last4: '4821',
        type: 'credit',
      },
      pocket: null,
      destinationAccount: null,
    });
    expect(byKind('pocketWithdrawal')).toEqual({
      id: ids.withdrawal,
      kind: 'pocketWithdrawal',
      title: 'Fondo de Emergencia',
      amount: 100,
      date: today(),
      time: null,
      category: null,
      icon: 'shield',
      account: debit,
      card: null,
      pocket: { id: pocketId, name: 'Fondo de Emergencia', icon: 'shield' },
      destinationAccount: null,
    });
    expect(byKind('transfer')).toEqual({
      id: ids.cardPayment,
      kind: 'transfer',
      title: 'BBVA Oro',
      amount: 50,
      date: today(),
      time: null,
      category: null,
      icon: null,
      account: debit,
      card: null,
      pocket: null,
      destinationAccount: credit,
    });
    // Con comercio, el título es el comercio y no el concepto.
    expect(
      page.items.find((item: { id: string }) => item.id === ids.groceries)
        .title,
    ).toBe('La Comer');
  });

  it('filtra por uno o varios tipos, y los totales son solo de lo filtrado', async () => {
    const savings = await search('?kind=pocketDeposit,pocketWithdrawal');
    expect(kindsOf(savings)).toEqual([
      'pocketWithdrawal:Fondo de Emergencia',
      'pocketDeposit:Fondo de Emergencia',
    ]);
    expect(savings.summary).toEqual({
      income: 0,
      expense: 0,
      pocketDeposits: 500,
      pocketWithdrawals: 100,
      balance: 0,
    });
    expect(kindsOf(await search('?kind=income'))).toEqual([
      'income:Nómina quincenal',
    ]);
  });

  it('busca sin importar acentos ni mayúsculas, en concepto, notas, categoría, cuenta y tarjeta', async () => {
    expect(kindsOf(await search('?q=SÚPER'))).toEqual(['expense:La Comer']);
    expect(kindsOf(await search('?q=despensa'))).toEqual(['expense:La Comer']);
    expect(kindsOf(await search('?q=transporte'))).toEqual(['expense:Uber']);
    // La tarjeta del gasto y la cuenta destino del pago.
    expect(kindsOf(await search('?q=bbva'))).toEqual([
      'transfer:BBVA Oro',
      'expense:Uber',
    ]);
    expect(kindsOf(await search('?q=emergencia'))).toHaveLength(2);
  });

  it('toma % y _ como texto, no como comodines', async () => {
    expect((await search('?q=%25')).total).toBe(0);
    expect((await search('?q=_')).total).toBe(0);
  });

  it('filtra por categoría, medio, cuenta y tarjeta', async () => {
    expect(kindsOf(await search(`?categoryId=${CATEGORY.TRANSPORT}`))).toEqual([
      'expense:Uber',
    ]);
    // El pago de tarjeta entra a una cuenta de crédito.
    expect(kindsOf(await search('?accountType=credit'))).toEqual([
      'transfer:BBVA Oro',
      'expense:Uber',
    ]);
    expect(kindsOf(await search(`?cardId=${creditCardId}`))).toEqual([
      'transfer:BBVA Oro',
      'expense:Uber',
    ]);
    expect((await search(`?accountId=${ana.debitId}`)).total).toBe(5);
  });

  it('filtra por fechas y montos, inclusivos', async () => {
    expect(
      kindsOf(
        await search(
          `?from=${addDays(today(), -10)}&to=${addDays(today(), -5)}`,
        ),
      ),
    ).toEqual(['expense:La Comer', 'income:Nómina quincenal']);
    expect(kindsOf(await search('?minAmount=100&maxAmount=500'))).toEqual([
      'pocketWithdrawal:Fondo de Emergencia',
      'pocketDeposit:Fondo de Emergencia',
      'expense:La Comer',
    ]);
  });

  it('pagina sin cambiar el total ni los totales', async () => {
    const second = await search('?pageSize=2&page=2');
    expect(kindsOf(second)).toEqual([
      'pocketDeposit:Fondo de Emergencia',
      'expense:Uber',
    ]);
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect(second.summary.income).toBe(5000);
  });

  it('valida los filtros', async () => {
    const cases: [string, string][] = [
      [`?from=${today()}&to=${addDays(today(), -1)}`, 'to'],
      ['?kind=expense,regalo', 'kind'],
      ['?minAmount=500&maxAmount=100', 'maxAmount'],
      ['?accountType=bitcoin', 'accountType'],
      ['?cardId=no-es-uuid', 'cardId'],
    ];
    for (const [query, field] of cases) {
      const response = await ana.client.get(`/movements${query}`).expect(422);
      expect(response.body.error.fields).toHaveProperty([field]);
    }
  });

  it('otro usuario no ve nada', async () => {
    const beto = testApp.as({ sub: 'sub-beto-movimientos' });
    const page = (
      await beto.get(`/movements?cardId=${creditCardId}`).expect(200)
    ).body;
    expect(page).toMatchObject({ items: [], total: 0 });
  });
});
