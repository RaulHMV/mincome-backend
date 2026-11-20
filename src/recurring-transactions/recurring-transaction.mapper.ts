import { formatTimestamp } from '../common/dates';
import {
  FLOW_SUBTYPE_DB,
  FLOW_TYPE_DB,
  FlowSubtype,
  FlowType,
  Frequency,
  FREQUENCY_DB,
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
import type { RecurringTransactionViewRow } from './recurring-transactions.repository';

/** Contrato §2, `RecurringTransaction`. */
export interface RecurringTransactionDto {
  id: string;
  type: FlowType;
  subtype: FlowSubtype;
  amount: number;
  concept: string;
  paymentMethod: PaymentMethod;
  category: CategorySummary;
  account: AccountSummary;
  card: CardSummary | null;
  frequency: Frequency;
  /** dia_ejecucion; solo en monthly, null en las demás. */
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  /** null si está pausada o ya terminó. */
  nextRunDate: string | null;
  isActive: boolean;
  createdAt: string;
}

export function toRecurringTransactionDto(
  row: RecurringTransactionViewRow,
  timeZone: string,
): RecurringTransactionDto {
  return {
    id: row.id,
    type: fromDb(FLOW_TYPE_DB, row.type),
    subtype: fromDb(FLOW_SUBTYPE_DB, row.subtype),
    amount: toMoney(row.amount),
    concept: row.concept,
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
    frequency: fromDb(FREQUENCY_DB, row.frequency),
    dayOfMonth: row.dayOfMonth,
    startDate: row.startDate,
    endDate: row.endDate,
    nextRunDate: row.nextRunDate,
    isActive: row.isActive,
    createdAt: formatTimestamp(row.createdAt, timeZone),
  };
}
