import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { DbCardType } from '../common/enums';
import { toCents } from '../common/money';
import { Card } from './card.entity';
import { Transfer } from './transfer.entity';

export interface CardRow {
  id: string;
  userId: string;
  accountId: string;
  alias: string;
  bank: string | null;
  last4: string | null;
  type: DbCardType;
  creditLimit: string | null;
  cutoffDay: number | null;
  dueDay: number | null;
  colorHex: string | null;
  isActive: boolean;
  createdAt: Date;
  accountName: string;
  accountInitialBalance: string;
  accountInitialBalanceDate: string;
  accountIsActive: boolean;
}

const CARD_SELECT = `
  SELECT t.id, t.usuario_id AS "userId", t.cuenta_id AS "accountId", t.alias, t.banco AS bank,
         t.terminacion AS last4, t.tipo_tarjeta AS type, t.limite_credito::text AS "creditLimit",
         t.dia_corte AS "cutoffDay", t.dia_limite_pago AS "dueDay", t.color_hex AS "colorHex",
         t.activa AS "isActive", t.creado_en AS "createdAt",
         c.nombre AS "accountName", c.saldo_inicial::text AS "accountInitialBalance",
         c.fecha_saldo_inicial::text AS "accountInitialBalanceDate", c.activa AS "accountIsActive"
  FROM tarjetas t
  JOIN cuentas c ON c.id = t.cuenta_id`;

export interface TransferRow {
  id: string;
  amount: string;
  date: string;
  note: string | null;
  createdAt: Date;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  destinationId: string;
  destinationName: string;
  destinationType: string;
}

@Injectable()
export class CardsRepository {
  constructor(private readonly dataSource: DataSource) {}

  findForUser(
    userId: string,
    filters: { type: DbCardType | null; isActive: boolean | null },
  ): Promise<CardRow[]> {
    return this.dataSource.query(
      `${CARD_SELECT}
       WHERE t.usuario_id = $1
         AND ($2::tipo_tarjeta IS NULL OR t.tipo_tarjeta = $2)
         AND ($3::boolean IS NULL OR t.activa = $3)
       ORDER BY t.tipo_tarjeta, lower(t.alias), t.id`,
      [userId, filters.type, filters.isActive],
    );
  }

  async findOwned(
    userId: string,
    cardId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<CardRow | null> {
    const rows: CardRow[] = await manager.query(
      `${CARD_SELECT} WHERE t.id = $1 AND t.usuario_id = $2`,
      [cardId, userId],
    );
    return rows[0] ?? null;
  }

  /** Alias y banco + terminación no se repiten entre las tarjetas activas (§2.3). */
  async findConflicts(
    manager: EntityManager,
    userId: string,
    card: { alias: string; bank: string | null; last4: string | null },
    exceptId: string | null,
  ): Promise<{ alias: boolean; bankAndLast4: boolean }> {
    const rows: { alias: boolean; bankAndLast4: boolean }[] =
      await manager.query(
        `SELECT
         COALESCE(bool_or(lower(alias) = lower($2)), false) AS alias,
         COALESCE(bool_or($3::varchar IS NOT NULL AND $4::char(4) IS NOT NULL
                          AND lower(banco) = lower($3) AND terminacion = $4), false) AS "bankAndLast4"
       FROM tarjetas
       WHERE usuario_id = $1 AND activa AND ($5::uuid IS NULL OR id <> $5)`,
        [userId, card.alias, card.bank, card.last4, exceptId],
      );
    return rows[0];
  }

  async insert(manager: EntityManager, card: Partial<Card>): Promise<string> {
    const result = await manager.insert(Card, card);
    return String(result.identifiers[0].id);
  }

  async update(
    manager: EntityManager,
    cardId: string,
    changes: Partial<Card>,
  ): Promise<void> {
    await manager.update(
      Card,
      { id: cardId },
      { ...changes, updatedAt: () => 'now()' },
    );
  }

  /** ¿La tarjeta o su cuenta de crédito ya tienen historial? Entonces se desactiva en vez de borrarse (D16). */
  async hasHistory(manager: EntityManager, card: CardRow): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM transacciones WHERE tarjeta_id = $1
       UNION ALL SELECT 1 FROM transacciones_recurrentes WHERE tarjeta_id = $1
       UNION ALL SELECT 1 FROM transacciones WHERE cuenta_id = $2 AND $3
       UNION ALL SELECT 1 FROM traspasos WHERE (cuenta_origen_id = $2 OR cuenta_destino_id = $2) AND $3
       LIMIT 1`,
      [card.id, card.accountId, card.type === 'credito'],
    );
    return rows.length > 0;
  }

  async delete(manager: EntityManager, card: CardRow): Promise<void> {
    await manager.query(`DELETE FROM tarjetas WHERE id = $1`, [card.id]);
    if (card.type === 'credito') {
      await manager.query(`DELETE FROM cuentas WHERE id = $1`, [
        card.accountId,
      ]);
    }
  }

  /** Las recurrentes que usan la tarjeta dejan de generar movimientos. */
  async pauseRecurringTransactions(
    manager: EntityManager,
    cardId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE transacciones_recurrentes SET activa = false, actualizado_en = now()
       WHERE tarjeta_id = $1 AND activa`,
      [cardId],
    );
  }

  /** Pagos que entraron a cada cuenta de crédito después de su último corte. */
  async paymentsSince(
    cutoffs: { accountId: string; cutoffDate: string }[],
  ): Promise<Map<string, number>> {
    if (cutoffs.length === 0) {
      return new Map();
    }
    const rows: { accountId: string; total: string }[] =
      await this.dataSource.query(
        `SELECT p.cuenta_id AS "accountId", COALESCE(SUM(x.monto), 0)::text AS total
       FROM unnest($1::uuid[], $2::date[]) AS p(cuenta_id, corte)
       LEFT JOIN traspasos x ON x.cuenta_destino_id = p.cuenta_id AND x.fecha > p.corte
       GROUP BY p.cuenta_id`,
        [
          cutoffs.map((cutoff) => cutoff.accountId),
          cutoffs.map((cutoff) => cutoff.cutoffDate),
        ],
      );
    return new Map(rows.map((row) => [row.accountId, toCents(row.total)]));
  }

  async insertTransfer(
    manager: EntityManager,
    transfer: Partial<Transfer>,
  ): Promise<string> {
    const result = await manager.insert(Transfer, transfer);
    return String(result.identifiers[0].id);
  }

  async findTransfer(
    userId: string,
    transferId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<TransferRow | null> {
    const rows: TransferRow[] = await manager.query(
      `SELECT x.id, x.monto::text AS amount, x.fecha::text AS date, x.nota AS note, x.creado_en AS "createdAt",
              o.id AS "sourceId", o.nombre AS "sourceName", o.tipo AS "sourceType",
              d.id AS "destinationId", d.nombre AS "destinationName", d.tipo AS "destinationType"
       FROM traspasos x
       JOIN cuentas o ON o.id = x.cuenta_origen_id
       JOIN cuentas d ON d.id = x.cuenta_destino_id
       WHERE x.id = $1 AND x.usuario_id = $2`,
      [transferId, userId],
    );
    return rows[0] ?? null;
  }
}
