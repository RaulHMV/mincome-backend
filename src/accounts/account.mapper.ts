import { ACCOUNT_TYPE_DB, AccountType, fromDb } from '../common/enums';
import { fromCents, toMoney } from '../common/money';
import { toCardSummary, type CardSummary } from '../common/summaries';
import type { Account } from './account.entity';
import type { AccountCardRow } from './accounts.repository';

/** Contrato §2, `Account`. */
export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  /** Calculado; en crédito sale negativo = deuda. */
  balance: number;
  initialBalance: number;
  initialBalanceDate: string;
  isActive: boolean;
  cards: CardSummary[];
}

export function toAccountDto(
  account: Account,
  balanceCents: number,
  cards: AccountCardRow[],
): AccountDto {
  return {
    id: account.id,
    name: account.name,
    type: fromDb(ACCOUNT_TYPE_DB, account.type),
    balance: fromCents(balanceCents),
    initialBalance: toMoney(account.initialBalance),
    initialBalanceDate: account.initialBalanceDate,
    isActive: account.isActive,
    cards: cards.map(toCardSummary),
  };
}
