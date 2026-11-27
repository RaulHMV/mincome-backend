import { formatTimestamp } from '../common/dates';
import { CARD_TYPE_DB, CardType, fromDb } from '../common/enums';
import { fromCents, toMoney, toMoneyOrNull } from '../common/money';
import { toAccountSummary, type AccountSummary } from '../common/summaries';
import type { CardRow, TransferRow } from './cards.repository';

/** Contrato §2, `Card`. En débito, los campos de crédito vienen en null. */
export interface CardDto {
  id: string;
  alias: string;
  bank: string | null;
  last4: string | null;
  type: CardType;
  colorHex: string | null;
  isActive: boolean;
  accountId: string;
  createdAt: string;
  creditLimit: number | null;
  cutoffDay: number | null;
  dueDay: number | null;
  usedCredit: number | null;
  availableCredit: number | null;
  nextCutoffDate: string | null;
  nextDueDate: string | null;
  paymentToAvoidInterest: number | null;
  balance: number | null;
}

export interface CreditStatus {
  usedCreditCents: number;
  availableCreditCents: number;
  nextCutoffDate: string;
  nextDueDate: string;
  paymentToAvoidInterestCents: number;
}

export function toCardDto(
  card: CardRow,
  computed: { credit: CreditStatus | null; balanceCents: number | null },
  timeZone: string,
): CardDto {
  const { credit } = computed;
  return {
    id: card.id,
    alias: card.alias,
    bank: card.bank,
    last4: card.last4,
    type: fromDb(CARD_TYPE_DB, card.type),
    colorHex: card.colorHex,
    isActive: card.isActive,
    accountId: card.accountId,
    createdAt: formatTimestamp(card.createdAt, timeZone),
    creditLimit: toMoneyOrNull(card.creditLimit),
    cutoffDay: card.cutoffDay,
    dueDay: card.dueDay,
    usedCredit: credit ? fromCents(credit.usedCreditCents) : null,
    availableCredit: credit ? fromCents(credit.availableCreditCents) : null,
    nextCutoffDate: credit?.nextCutoffDate ?? null,
    nextDueDate: credit?.nextDueDate ?? null,
    paymentToAvoidInterest: credit
      ? fromCents(credit.paymentToAvoidInterestCents)
      : null,
    balance:
      computed.balanceCents === null ? null : fromCents(computed.balanceCents),
  };
}

/** Contrato §2, `Transfer`. */
export interface TransferDto {
  id: string;
  sourceAccount: AccountSummary;
  destinationAccount: AccountSummary;
  amount: number;
  date: string;
  note: string | null;
  createdAt: string;
}

export function toTransferDto(row: TransferRow, timeZone: string): TransferDto {
  return {
    id: row.id,
    sourceAccount: toAccountSummary({
      id: row.sourceId,
      name: row.sourceName,
      type: row.sourceType,
    }),
    destinationAccount: toAccountSummary({
      id: row.destinationId,
      name: row.destinationName,
      type: row.destinationType,
    }),
    amount: toMoney(row.amount),
    date: row.date,
    note: row.note,
    createdAt: formatTimestamp(row.createdAt, timeZone),
  };
}
