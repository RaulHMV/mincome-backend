import { formatTime } from '../common/dates';
import { toMoney } from '../common/money';
import type { Page } from '../common/pagination';
import {
  toAccountSummary,
  toCardSummary,
  type AccountSummary,
  type CardSummary,
  type CategorySummary,
  type PocketSummary,
} from '../common/summaries';
import type { MovementKind } from './dto/movement.dto';

/** Una fila de la unión de transacciones, movimientos de apartados y traspasos. */
export interface MovementRow {
  kind: MovementKind;
  id: string;
  date: string;
  time: string | null;
  amount: string;
  title: string;
  icon: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: string;
  accountName: string;
  accountType: string;
  cardId: string | null;
  cardAlias: string | null;
  cardLast4: string | null;
  cardType: string | null;
  pocketId: string | null;
  pocketName: string | null;
  pocketIcon: string | null;
  destinationAccountId: string | null;
  destinationAccountName: string | null;
  destinationAccountType: string | null;
}

/** Contrato §2, `Movement`. */
export interface MovementDto {
  /** El de la fila original; con `kind` el front sabe dónde se edita. */
  id: string;
  kind: MovementKind;
  /** Transacción: comercio, o concepto si no hay. Apartado: su nombre. Traspaso: la cuenta destino. */
  title: string;
  amount: number;
  date: string;
  time: string | null;
  category: CategorySummary | null;
  icon: string | null;
  /** La cuenta afectada; en traspasos, la de origen. */
  account: AccountSummary;
  card: CardSummary | null;
  pocket: PocketSummary | null;
  destinationAccount: AccountSummary | null;
}

export interface MovementSummary {
  income: number;
  expense: number;
  pocketDeposits: number;
  pocketWithdrawals: number;
  /** income − expense. */
  balance: number;
}

/** Contrato §2, `MovementPage`: la página, más los totales de todo lo que cumple los filtros. */
export interface MovementPage extends Page<MovementDto> {
  summary: MovementSummary;
}

export function toMovementDto(row: MovementRow): MovementDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    amount: toMoney(row.amount),
    date: row.date,
    time: formatTime(row.time),
    category:
      row.categoryId === null
        ? null
        : {
            id: row.categoryId,
            name: row.categoryName ?? '',
            icon: row.categoryIcon,
          },
    icon: row.icon,
    account: toAccountSummary({
      id: row.accountId,
      name: row.accountName,
      type: row.accountType,
    }),
    card:
      row.cardId === null
        ? null
        : toCardSummary({
            id: row.cardId,
            alias: row.cardAlias ?? '',
            last4: row.cardLast4,
            type: row.cardType ?? '',
          }),
    pocket:
      row.pocketId === null
        ? null
        : {
            id: row.pocketId,
            name: row.pocketName ?? '',
            icon: row.pocketIcon,
          },
    destinationAccount:
      row.destinationAccountId === null
        ? null
        : toAccountSummary({
            id: row.destinationAccountId,
            name: row.destinationAccountName ?? '',
            type: row.destinationAccountType ?? '',
          }),
  };
}
