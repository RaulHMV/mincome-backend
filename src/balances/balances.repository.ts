import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { DbAccountType } from '../common/enums';
import { toCents } from '../common/money';
import type { AccountBalance } from './balances.calculator';

export interface BalanceFilters {
  accountIds?: string[];
  /** Al editar una transacción, su propio efecto no cuenta para revisar el disponible. */
  excludeTransactionId?: string;
}

/**
 * El saldo de cada cuenta al cierre de cada fecha (requerimientos-backend.md
 * §3.1). Solo cuentan los movimientos con fecha >= fecha_saldo_inicial: el
 * saldo inicial es al comienzo de ese día. Una cuenta todavía no existe en
 * una fecha anterior a su saldo inicial, así que no aparece en esa fecha.
 */
const BALANCES_SQL = `
  SELECT corte.fecha::text AS date, c.id AS "accountId", c.tipo AS type,
    (c.saldo_inicial
      + COALESCE((
          SELECT SUM(CASE WHEN t.tipo_flujo = 'ingreso' THEN t.monto ELSE -t.monto END)
          FROM transacciones t
          WHERE t.cuenta_id = c.id
            AND t.fecha >= c.fecha_saldo_inicial AND t.fecha <= corte.fecha
            AND ($4::uuid IS NULL OR t.id <> $4)
        ), 0)
      + COALESCE((
          SELECT SUM(x.monto) FROM traspasos x
          WHERE x.cuenta_destino_id = c.id
            AND x.fecha >= c.fecha_saldo_inicial AND x.fecha <= corte.fecha
        ), 0)
      - COALESCE((
          SELECT SUM(x.monto) FROM traspasos x
          WHERE x.cuenta_origen_id = c.id
            AND x.fecha >= c.fecha_saldo_inicial AND x.fecha <= corte.fecha
        ), 0)
      - COALESCE((
          SELECT SUM(CASE WHEN m.tipo = 'abono' THEN m.monto ELSE -m.monto END)
          FROM movimientos_apartado m
          WHERE m.cuenta_id = c.id
            AND m.fecha >= c.fecha_saldo_inicial AND m.fecha <= corte.fecha
        ), 0)
    )::text AS balance
  FROM cuentas c
  CROSS JOIN unnest($2::date[]) AS corte(fecha)
  WHERE c.usuario_id = $1
    AND c.fecha_saldo_inicial <= corte.fecha
    AND ($3::uuid[] IS NULL OR c.id = ANY($3))
`;

@Injectable()
export class BalancesRepository {
  async balancesAt(
    manager: EntityManager,
    userId: string,
    dates: string[],
    filters: BalanceFilters = {},
  ): Promise<(AccountBalance & { date: string })[]> {
    const rows: {
      date: string;
      accountId: string;
      type: DbAccountType;
      balance: string;
    }[] = await manager.query(BALANCES_SQL, [
      userId,
      dates,
      filters.accountIds ?? null,
      filters.excludeTransactionId ?? null,
    ]);
    return rows.map((row) => ({
      date: row.date,
      accountId: row.accountId,
      type: row.type,
      balanceCents: toCents(row.balance),
    }));
  }

  /** Capital en Apartados al cierre de cada fecha, con la bitácora de movimientos. */
  async pocketsBalanceAt(
    manager: EntityManager,
    userId: string,
    dates: string[],
  ): Promise<Map<string, number>> {
    const rows: { date: string; balance: string }[] = await manager.query(
      `SELECT corte.fecha::text AS date,
              COALESCE(SUM(CASE WHEN m.tipo = 'abono' THEN m.monto ELSE -m.monto END), 0)::text AS balance
       FROM unnest($2::date[]) AS corte(fecha)
       LEFT JOIN movimientos_apartado m ON m.usuario_id = $1 AND m.fecha <= corte.fecha
       GROUP BY corte.fecha`,
      [userId, dates],
    );
    return new Map(rows.map((row) => [row.date, toCents(row.balance)]));
  }

  /** La primera fecha_saldo_inicial: desde ahí hay historia de patrimonio. */
  async firstInitialBalanceDate(
    manager: EntityManager,
    userId: string,
  ): Promise<string | null> {
    const rows: { date: string | null }[] = await manager.query(
      `SELECT MIN(fecha_saldo_inicial)::text AS date FROM cuentas WHERE usuario_id = $1`,
      [userId],
    );
    return rows[0]?.date ?? null;
  }

  /** Bloquea las filas de las cuentas para que dos gastos simultáneos no pasen la revisión del saldo. */
  async lockAccounts(
    manager: EntityManager,
    accountIds: string[],
  ): Promise<void> {
    if (accountIds.length > 0) {
      await manager.query(
        `SELECT id FROM cuentas WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [[...new Set(accountIds)]],
      );
    }
  }

  async creditLimitCents(
    manager: EntityManager,
    accountId: string,
  ): Promise<number | null> {
    const rows: { creditLimit: string | null }[] = await manager.query(
      `SELECT limite_credito::text AS "creditLimit" FROM tarjetas
       WHERE cuenta_id = $1 AND tipo_tarjeta = 'credito'
       LIMIT 1`,
      [accountId],
    );
    return rows[0]?.creditLimit ? toCents(rows[0].creditLimit) : null;
  }
}
