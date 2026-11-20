import {
  AccountType,
  ACCOUNT_TYPE_DB,
  CARD_TYPE_DB,
  CardType,
  fromDb,
} from './enums';

// Las versiones cortas que van dentro de otros objetos (contrato §2, "Resúmenes").

export interface CategorySummary {
  id: number;
  name: string;
  icon: string | null;
}

export interface AccountSummary {
  id: string;
  name: string;
  type: AccountType;
}

export interface CardSummary {
  id: string;
  alias: string;
  last4: string | null;
  type: CardType;
}

export interface PocketSummary {
  id: string;
  name: string;
  icon: string | null;
}

export function toAccountSummary(row: {
  id: string;
  name: string;
  type: string;
}): AccountSummary {
  return {
    id: row.id,
    name: row.name,
    type: fromDb(ACCOUNT_TYPE_DB, row.type),
  };
}

export function toCardSummary(row: {
  id: string;
  alias: string;
  last4: string | null;
  type: string;
}): CardSummary {
  return {
    id: row.id,
    alias: row.alias,
    last4: row.last4,
    type: fromDb(CARD_TYPE_DB, row.type),
  };
}
