import { formatTimestamp } from '../common/dates';
import {
  fromDb,
  POCKET_MOVEMENT_TYPE_DB,
  PocketMovementType,
} from '../common/enums';
import { toCents, toMoney, toMoneyOrNull } from '../common/money';
import { toAccountSummary, type AccountSummary } from '../common/summaries';
import { pocketProgress } from './pocket.calculator';
import type { PocketMovementViewRow, PocketRow } from './pockets.repository';

/** Contrato §2, `Pocket`. */
export interface PocketDto {
  id: string;
  name: string;
  balance: number;
  targetAmount: number | null;
  targetDate: string | null;
  /** null si no tiene meta. */
  progress: number | null;
  icon: string | null;
  colorHex: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Contrato §2, `PocketMovement`. */
export interface PocketMovementDto {
  /** null en una vista previa con ?dryRun=true. */
  id: string | null;
  pocketId: string;
  type: PocketMovementType;
  amount: number;
  date: string;
  note: string | null;
  account: AccountSummary;
  createdAt: string;
}

export function toPocketDto(pocket: PocketRow, timeZone: string): PocketDto {
  return {
    id: pocket.id,
    name: pocket.name,
    balance: toMoney(pocket.balance),
    targetAmount: toMoneyOrNull(pocket.targetAmount),
    targetDate: pocket.targetDate,
    progress: pocketProgress(
      toCents(pocket.balance),
      pocket.targetAmount === null ? null : toCents(pocket.targetAmount),
    ),
    icon: pocket.icon,
    colorHex: pocket.colorHex,
    isActive: pocket.isActive,
    createdAt: formatTimestamp(pocket.createdAt, timeZone),
  };
}

export function toPocketMovementDto(
  row: PocketMovementViewRow,
  timeZone: string,
): PocketMovementDto {
  return {
    id: row.id,
    pocketId: row.pocketId,
    type: fromDb(POCKET_MOVEMENT_TYPE_DB, row.type),
    amount: toMoney(row.amount),
    date: row.date,
    note: row.note,
    account: toAccountSummary({
      id: row.accountId,
      name: row.accountName,
      type: row.accountType,
    }),
    createdAt: formatTimestamp(row.createdAt, timeZone),
  };
}
