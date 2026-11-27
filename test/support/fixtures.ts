import { randomUUID } from 'node:crypto';
import { addMonths, monthOf, todayIn } from '../../src/common/dates';
import type { TestApp, UserClient } from './test-app';

export const TIME_ZONE = 'America/Mexico_City';

export function today(): string {
  return todayIn(TIME_ZONE);
}

export function currentMonth(): string {
  return monthOf(today());
}

export function previousMonth(): string {
  return addMonths(currentMonth(), -1);
}

export const CATEGORY = {
  FOOD: 1,
  TRANSPORT: 4,
  SERVICES: 5,
  HOME: 6,
  PAYROLL: 11,
} as const;

export interface UserSetup {
  client: UserClient;
  cashId: string;
  debitId: string;
}

/** Un usuario con su cuenta Efectivo y una cuenta de débito "Nómina" con saldo. */
export async function setUpUser(
  testApp: TestApp,
  sub: string,
  {
    debitBalance = 10_000,
    initialBalanceDate,
  }: { debitBalance?: number; initialBalanceDate?: string } = {},
): Promise<UserSetup> {
  const client = testApp.as({ sub, name: sub });
  const accounts = await client.get('/accounts').expect(200);
  const debit = await client
    .post('/accounts')
    .send({
      name: 'Nómina',
      type: 'debit',
      initialBalance: debitBalance,
      ...(initialBalanceDate ? { initialBalanceDate } : {}),
    })
    .expect(201);
  return { client, cashId: accounts.body[0].id, debitId: debit.body.id };
}

export function postTransaction(
  client: UserClient,
  body: Record<string, unknown>,
  query = '',
) {
  return client
    .post(`/transactions${query}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

export function expense(
  accountId: string,
  amount: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'expense',
    subtype: 'variable',
    categoryId: CATEGORY.TRANSPORT,
    amount,
    date: today(),
    concept: 'Uber',
    paymentMethod: 'transfer',
    accountId,
    ...overrides,
  };
}
