import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { DbAccountType, DbCardType } from '../common/enums';
import { Account } from './account.entity';

const ACCOUNT_COLUMNS = `id, usuario_id AS "userId", nombre AS name, tipo AS type,
  saldo_inicial::text AS "initialBalance", fecha_saldo_inicial::text AS "initialBalanceDate",
  activa AS "isActive", creado_en AS "createdAt", actualizado_en AS "updatedAt"`;

export interface AccountCardRow {
  accountId: string;
  id: string;
  alias: string;
  last4: string | null;
  type: DbCardType;
}

export interface NewAccount {
  userId: string;
  name: string;
  type: DbAccountType;
  initialBalance: string;
  initialBalanceDate: string;
}

@Injectable()
export class AccountsRepository {
  constructor(private readonly dataSource: DataSource) {}

  findForUser(userId: string, includeInactive: boolean): Promise<Account[]> {
    return this.dataSource.query(
      `SELECT ${ACCOUNT_COLUMNS}
       FROM cuentas
       WHERE usuario_id = $1 AND ($2 OR activa)
       ORDER BY CASE tipo WHEN 'efectivo' THEN 0 WHEN 'debito' THEN 1 ELSE 2 END, lower(nombre), id`,
      [userId, includeInactive],
    );
  }

  async findOwned(
    userId: string,
    accountId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Account | null> {
    const rows: Account[] = await manager.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM cuentas WHERE id = $1 AND usuario_id = $2`,
      [accountId, userId],
    );
    return rows[0] ?? null;
  }

  /** Las tarjetas activas de cada cuenta: la lista `cards` de `Account`. */
  findActiveCards(accountIds: string[]): Promise<AccountCardRow[]> {
    if (accountIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.dataSource.query(
      `SELECT cuenta_id AS "accountId", id, alias, terminacion AS last4, tipo_tarjeta AS type
       FROM tarjetas
       WHERE cuenta_id = ANY($1::uuid[]) AND activa
       ORDER BY lower(alias), id`,
      [accountIds],
    );
  }

  /** El nombre se repite solo entre cuentas activas, sin distinguir mayúsculas. */
  async isNameTaken(
    userId: string,
    name: string,
    exceptId: string | null = null,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM cuentas
       WHERE usuario_id = $1 AND activa AND lower(nombre) = lower($2)
         AND ($3::uuid IS NULL OR id <> $3)
       LIMIT 1`,
      [userId, name, exceptId],
    );
    return rows.length > 0;
  }

  /**
   * ¿Hay traspasos o movimientos de apartado antes de `date`? Esos dos lados
   * se tienen que contar a la vez; si el saldo inicial pasa a ser posterior,
   * solo contaría uno y el patrimonio dejaría de cuadrar.
   */
  async hasTransfersOrPocketMovementsBefore(
    manager: EntityManager,
    accountId: string,
    date: string,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM traspasos
       WHERE (cuenta_origen_id = $1 OR cuenta_destino_id = $1) AND fecha < $2
       UNION ALL
       SELECT 1 FROM movimientos_apartado WHERE cuenta_id = $1 AND fecha < $2
       LIMIT 1`,
      [accountId, date],
    );
    return rows.length > 0;
  }

  async insert(manager: EntityManager, account: NewAccount): Promise<string> {
    const result = await manager.insert(Account, account);
    return String(result.identifiers[0].id);
  }

  async update(
    manager: EntityManager,
    accountId: string,
    changes: Partial<
      Pick<
        Account,
        'name' | 'initialBalance' | 'initialBalanceDate' | 'isActive'
      >
    >,
  ): Promise<void> {
    await manager.update(
      Account,
      { id: accountId },
      { ...changes, updatedAt: () => 'now()' },
    );
  }

  /**
   * Al desactivar una cuenta se desactivan sus tarjetas y se pausan las
   * recurrentes que la usan: nada inactivo en movimientos nuevos (§4).
   */
  async deactivateDependents(
    manager: EntityManager,
    accountId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE tarjetas SET activa = false, actualizado_en = now() WHERE cuenta_id = $1 AND activa`,
      [accountId],
    );
    await manager.query(
      `UPDATE transacciones_recurrentes SET activa = false, actualizado_en = now()
       WHERE cuenta_id = $1 AND activa`,
      [accountId],
    );
  }
}
