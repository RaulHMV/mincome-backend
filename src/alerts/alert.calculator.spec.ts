import type { BudgetDto } from '../budgets/budget.mapper';
import type { CardDto } from '../cards/card.mapper';
import { AlertLevel, CardType } from '../common/enums';
import type { PocketRow } from '../pockets/pockets.repository';
import {
  AlertType,
  budgetAlert,
  cardPaymentAlert,
  pocketGoalAlert,
  readSignature,
  sortAlerts,
  type AlertDto,
} from './alert.calculator';

const budget = (changes: Partial<BudgetDto>): BudgetDto => ({
  id: 'b1',
  category: { id: 4, name: 'Transporte', icon: 'car' },
  limit: 800,
  alertThreshold: 80,
  spent: 820,
  percentage: 102,
  alertLevel: AlertLevel.EXCEEDED,
  isActive: true,
  effectiveFrom: '2026-08-01',
  ...changes,
});

// Corte el 12, pago el 2: hoy es 24 de octubre, el último corte fue el 12.
const card = (changes: Partial<CardDto>): CardDto => ({
  id: 't1',
  alias: 'BBVA Oro',
  bank: 'BBVA',
  last4: '4821',
  type: CardType.CREDIT,
  colorHex: null,
  isActive: true,
  accountId: 'c1',
  createdAt: '2026-08-01T00:00:00-06:00',
  creditLimit: 7000,
  cutoffDay: 12,
  dueDay: 2,
  usedCredit: 2450,
  availableCredit: 4550,
  nextCutoffDate: '2026-11-12',
  nextDueDate: '2026-11-02',
  paymentToAvoidInterest: 1650,
  balance: null,
  ...changes,
});

const pocket = (changes: Partial<PocketRow>): PocketRow => ({
  id: 'a1',
  userId: 'u1',
  name: 'Vacaciones en Oaxaca',
  balance: '1800.00',
  targetAmount: '4500.00',
  targetDate: '2026-11-15',
  colorHex: null,
  icon: 'travel',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...changes,
});

describe('budgetAlert', () => {
  it('avisa en preventiva y excedida, con el mes en el id', () => {
    expect(budgetAlert(budget({}), '2026-10')).toEqual({
      id: 'budget:b1:2026-10',
      type: AlertType.BUDGET,
      isRead: false,
      alertLevel: AlertLevel.EXCEEDED,
      percentage: 102,
      budgetId: 'b1',
      category: { id: 4, name: 'Transporte', icon: 'car' },
    });
    expect(
      budgetAlert(
        budget({ alertLevel: AlertLevel.NONE, percentage: 50 }),
        '2026-10',
      ),
    ).toBeNull();
  });
});

describe('cardPaymentAlert', () => {
  it('avisa 10 días antes con lo que hay que pagar para no generar intereses', () => {
    expect(cardPaymentAlert(card({}), '2026-10-24')).toEqual({
      id: 'cardPayment:t1:2026-11-02',
      type: AlertType.CARD_PAYMENT,
      isRead: false,
      dueDate: '2026-11-02',
      daysLeft: 9,
      amount: 1650,
      card: {
        id: 't1',
        alias: 'BBVA Oro',
        last4: '4821',
        type: CardType.CREDIT,
      },
    });
  });

  it('el mismo día del pago todavía avisa; 11 días antes, no', () => {
    expect(cardPaymentAlert(card({}), '2026-11-02')?.daysLeft).toBe(0);
    expect(cardPaymentAlert(card({}), '2026-10-22')).toBeNull();
  });

  it('sin nada que pagar o con la fecha de un corte que no ha cerrado, no avisa', () => {
    expect(
      cardPaymentAlert(card({ paymentToAvoidInterest: 0 }), '2026-10-24'),
    ).toBeNull();
    // Corte el 25 y pago el 28: el 20 el pago que viene es del corte que aún no cierra.
    expect(
      cardPaymentAlert(
        card({ cutoffDay: 25, dueDay: 28, nextDueDate: '2026-10-28' }),
        '2026-10-20',
      ),
    ).toBeNull();
  });
});

describe('pocketGoalAlert', () => {
  it('avisa con la fecha meta en 30 días o menos y sin cumplir', () => {
    expect(pocketGoalAlert(pocket({}), '2026-10-24')).toEqual({
      id: 'pocketGoal:a1',
      type: AlertType.POCKET_GOAL,
      isRead: false,
      targetDate: '2026-11-15',
      daysLeft: 22,
      progress: 40,
      pocket: { id: 'a1', name: 'Vacaciones en Oaxaca', icon: 'travel' },
    });
  });

  it('no avisa si ya se cumplió, si la fecha está lejos o ya pasó, ni sin meta', () => {
    expect(
      pocketGoalAlert(pocket({ balance: '4500.00' }), '2026-10-24'),
    ).toBeNull();
    expect(
      pocketGoalAlert(pocket({ targetDate: '2027-01-15' }), '2026-10-24'),
    ).toBeNull();
    expect(
      pocketGoalAlert(pocket({ targetDate: '2026-10-23' }), '2026-10-24'),
    ).toBeNull();
    expect(
      pocketGoalAlert(pocket({ targetDate: null }), '2026-10-24'),
    ).toBeNull();
    expect(
      pocketGoalAlert(pocket({ isActive: false }), '2026-10-24'),
    ).toBeNull();
  });
});

describe('readSignature y sortAlerts', () => {
  const warning = budgetAlert(
    budget({ id: 'b2', alertLevel: AlertLevel.WARNING, percentage: 84 }),
    '2026-10',
  ) as AlertDto;
  const exceeded = budgetAlert(budget({}), '2026-10') as AlertDto;
  const payment = cardPaymentAlert(card({}), '2026-10-24') as AlertDto;
  const goal = pocketGoalAlert(pocket({}), '2026-10-24') as AlertDto;

  it('un presupuesto que pasa de preventiva a excedida cambia de firma', () => {
    expect(readSignature(warning)).not.toBe(readSignature(exceeded));
  });

  it('lo más urgente primero', () => {
    expect(
      sortAlerts([goal, warning, payment, exceeded]).map((alert) => alert.id),
    ).toEqual([
      'cardPayment:t1:2026-11-02',
      'budget:b1:2026-10',
      'budget:b2:2026-10',
      'pocketGoal:a1',
    ]);
  });
});
