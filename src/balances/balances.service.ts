import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ACCOUNT_TYPE_DB,
  AccountType,
  type DbAccountType,
} from '../common/enums';
import { InsufficientFundsError } from '../common/errors/api-error';
import {
  summarizeBalances,
  type AccountBalance,
  type BalanceSummary,
} from './balances.calculator';
import { BalancesRepository, type BalanceFilters } from './balances.repository';

export interface FundsAccount {
  id: string;
  type: DbAccountType;
  initialBalanceDate: string;
}

export interface SpendCheck {
  account: FundsAccount;
  amountCents: number;
  /** Fecha del movimiento: si es anterior al saldo inicial, no lo mueve y no se revisa. */
  date: string;
  /** "Hoy" del usuario: el disponible es el de hoy. */
  today: string;
  excludeTransactionId?: string;
  field: string;
}

/**
 * Saldos y patrimonio (requerimientos-backend.md §3.1). Toda pantalla, el
 * proceso de recurrentes y las herramientas de Piggy pasan por aquí, así que
 * el Saldo Libre del Dashboard y el de Piggy no pueden diferir.
 */
@Injectable()
export class BalancesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly balancesRepository: BalancesRepository,
  ) {}

  /** El saldo de cada cuenta del usuario al cierre de `date`. */
  async accountBalancesOn(
    userId: string,
    date: string,
    filters: BalanceFilters = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, AccountBalance>> {
    const rows = await this.balancesRepository.balancesAt(
      manager,
      userId,
      [date],
      filters,
    );
    return new Map(rows.map((row) => [row.accountId, row]));
  }

  /** Saldos de varias cuentas en varias fechas: el saldo de `accountId` al cierre de `date`, o undefined si la cuenta todavía no existía. */
  async accountBalancesAt(
    userId: string,
    dates: string[],
    filters: BalanceFilters = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<(date: string, accountId: string) => number | undefined> {
    const rows = await this.balancesRepository.balancesAt(
      manager,
      userId,
      dates,
      filters,
    );
    const byKey = new Map(
      rows.map((row) => [`${row.date}|${row.accountId}`, row.balanceCents]),
    );
    return (date, accountId) => byKey.get(`${date}|${accountId}`);
  }

  async summaryOn(
    userId: string,
    date: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<BalanceSummary> {
    const [summary] = await this.summariesOn(userId, [date], manager);
    return summary;
  }

  /** Un resumen por fecha, en el mismo orden. */
  async summariesOn(
    userId: string,
    dates: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<BalanceSummary[]> {
    const [balances, pockets] = await Promise.all([
      this.balancesRepository.balancesAt(manager, userId, dates),
      this.balancesRepository.pocketsBalanceAt(manager, userId, dates),
    ]);
    return dates.map((date) =>
      summarizeBalances(
        balances.filter((balance) => balance.date === date),
        pockets.get(date) ?? 0,
      ),
    );
  }

  firstInitialBalanceDate(userId: string): Promise<string | null> {
    return this.balancesRepository.firstInitialBalanceDate(
      this.dataSource.manager,
      userId,
    );
  }

  lockAccounts(manager: EntityManager, accountIds: string[]): Promise<void> {
    return this.balancesRepository.lockAccounts(manager, accountIds);
  }

  async balanceCentsOf(
    manager: EntityManager,
    userId: string,
    accountId: string,
    date: string,
    excludeTransactionId?: string,
  ): Promise<number> {
    const balances = await this.accountBalancesOn(
      userId,
      date,
      { accountIds: [accountId], excludeTransactionId },
      manager,
    );
    return balances.get(accountId)?.balanceCents ?? 0;
  }

  /**
   * Un gasto, un abono o un pago no puede pasar del saldo de la cuenta de
   * efectivo o débito, ni del crédito disponible (decisión D14). Hay que
   * llamarlo después de lockAccounts(), dentro de la misma transacción.
   */
  async assertCanSpend(
    manager: EntityManager,
    userId: string,
    check: SpendCheck,
  ): Promise<void> {
    if (check.date < check.account.initialBalanceDate) {
      return;
    }
    const balanceCents = await this.balanceCentsOf(
      manager,
      userId,
      check.account.id,
      check.today,
      check.excludeTransactionId,
    );
    if (check.account.type === ACCOUNT_TYPE_DB[AccountType.CREDIT]) {
      const limitCents = await this.balancesRepository.creditLimitCents(
        manager,
        check.account.id,
      );
      const availableCents = (limitCents ?? 0) + balanceCents;
      if (check.amountCents > availableCents) {
        throw new InsufficientFundsError(
          'El monto es mayor al crédito disponible de la tarjeta.',
          {
            [check.field]: 'Es mayor al crédito disponible',
          },
        );
      }
      return;
    }
    if (check.amountCents > balanceCents) {
      throw new InsufficientFundsError(
        'El monto es mayor al saldo de la cuenta.',
        {
          [check.field]: 'Es mayor al saldo disponible',
        },
      );
    }
  }
}
