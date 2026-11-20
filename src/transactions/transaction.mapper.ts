import { formatTime, formatTimestamp } from '../common/dates';
import {
  ALERT_LEVEL_DB,
  AlertLevel,
  FLOW_SUBTYPE_DB,
  FLOW_TYPE_DB,
  FlowSubtype,
  FlowType,
  fromDb,
  PAYMENT_METHOD_DB,
  PaymentMethod,
} from '../common/enums';
import { toMoney } from '../common/money';
import {
  toAccountSummary,
  toCardSummary,
  type AccountSummary,
  type CardSummary,
  type CategorySummary,
} from '../common/summaries';
import type { TransactionViewRow } from './transactions.repository';

/** Contrato §2, `Transaction`. */
export interface TransactionDto {
  /** null en una vista previa con ?dryRun=true. */
  id: string | null;
  date: string;
  time: string | null;
  type: FlowType;
  subtype: FlowSubtype;
  amount: number;
  concept: string;
  merchant: string | null;
  notes: string | null;
  paymentMethod: PaymentMethod;
  category: CategorySummary;
  account: AccountSummary;
  card: CardSummary | null;
  recurringTransactionId: string | null;
  alertLevel: AlertLevel;
  createdAt: string;
  updatedAt: string;
}

export function toTransactionDto(
  row: TransactionViewRow,
  timeZone: string,
): TransactionDto {
  return {
    id: row.id,
    date: row.date,
    time: formatTime(row.time),
    type: fromDb(FLOW_TYPE_DB, row.type),
    subtype: fromDb(FLOW_SUBTYPE_DB, row.subtype),
    amount: toMoney(row.amount),
    concept: row.concept,
    merchant: row.merchant,
    notes: row.notes,
    paymentMethod: fromDb(PAYMENT_METHOD_DB, row.paymentMethod),
    category: {
      id: row.categoryId,
      name: row.categoryName,
      icon: row.categoryIcon,
    },
    account: toAccountSummary({
      id: row.accountId,
      name: row.accountName,
      type: row.accountType,
    }),
    card:
      row.cardId && row.cardAlias && row.cardType
        ? toCardSummary({
            id: row.cardId,
            alias: row.cardAlias,
            last4: row.cardLast4,
            type: row.cardType,
          })
        : null,
    recurringTransactionId: row.recurringTransactionId,
    alertLevel: fromDb(ALERT_LEVEL_DB, row.alertLevel),
    createdAt: formatTimestamp(row.createdAt, timeZone),
    updatedAt: formatTimestamp(row.updatedAt, timeZone),
  };
}
