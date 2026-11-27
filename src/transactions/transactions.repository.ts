import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type {
  DbAccountType,
  DbAlertLevel,
  DbCardType,
  DbFlowSubtype,
  DbFlowType,
  DbPaymentMethod,
} from '../common/enums';
import { Transaction } from './transaction.entity';

export interface TransactionViewRow {
  id: string;
  date: string;
  time: string | null;
  type: DbFlowType;
  subtype: DbFlowSubtype;
  amount: string;
  concept: string;
  merchant: string | null;
  notes: string | null;
  paymentMethod: DbPaymentMethod;
  alertLevel: DbAlertLevel;
  recurringTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  categoryId: number;
  categoryName: string;
  categoryIcon: string | null;
  accountId: string;
  accountName: string;
  accountType: DbAccountType;
  cardId: string | null;
  cardAlias: string | null;
  cardLast4: string | null;
  cardType: DbCardType | null;
}

export type GeneratedTransaction = Pick<
  Transaction,
  | 'userId'
  | 'categoryId'
  | 'accountId'
  | 'cardId'
  | 'type'
  | 'subtype'
  | 'amount'
  | 'date'
  | 'concept'
  | 'paymentMethod'
  | 'alertLevel'
> & { recurringTransactionId: string };

export const TRANSACTION_VIEW_SELECT = `
  SELECT t.id, t.fecha::text AS date, t.hora::text AS time, t.tipo_flujo AS type, t.subtipo AS subtype,
         t.monto::text AS amount, t.concepto AS concept, t.alias_comercial AS merchant, t.notas AS notes,
         t.metodo_pago AS "paymentMethod", t.nivel_alerta AS "alertLevel",
         t.recurrente_id AS "recurringTransactionId", t.creado_en AS "createdAt", t.actualizado_en AS "updatedAt",
         cat.id AS "categoryId", cat.nombre AS "categoryName", cat.icono AS "categoryIcon",
         c.id AS "accountId", c.nombre AS "accountName", c.tipo AS "accountType",
         tj.id AS "cardId", tj.alias AS "cardAlias", tj.terminacion AS "cardLast4", tj.tipo_tarjeta AS "cardType"
  FROM transacciones t
  JOIN categorias cat ON cat.id = t.categoria_id
  JOIN cuentas c ON c.id = t.cuenta_id
  LEFT JOIN tarjetas tj ON tj.id = t.tarjeta_id`;

@Injectable()
export class TransactionsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findView(
    userId: string,
    transactionId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<TransactionViewRow | null> {
    const rows: TransactionViewRow[] = await manager.query(
      `${TRANSACTION_VIEW_SELECT} WHERE t.id = $1 AND t.usuario_id = $2`,
      [transactionId, userId],
    );
    return rows[0] ?? null;
  }

  async findViews(
    userId: string,
    transactionIds: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<TransactionViewRow[]> {
    if (transactionIds.length === 0) {
      return [];
    }
    return manager.query(
      `${TRANSACTION_VIEW_SELECT}
       WHERE t.id = ANY($1::uuid[]) AND t.usuario_id = $2
       ORDER BY t.fecha, t.creado_en`,
      [transactionIds, userId],
    );
  }

  /** La fila para editar, bloqueada hasta que termine la transacción de BD. */
  async findOwnedForUpdate(
    manager: EntityManager,
    userId: string,
    transactionId: string,
  ): Promise<Transaction | null> {
    const rows: Transaction[] = await manager.query(
      `SELECT id, usuario_id AS "userId", categoria_id AS "categoryId", cuenta_id AS "accountId",
              tarjeta_id AS "cardId", recurrente_id AS "recurringTransactionId", tipo_flujo AS type,
              subtipo AS subtype, monto::text AS amount, fecha::text AS date, hora::text AS time,
              concepto AS concept, alias_comercial AS merchant, notas AS notes,
              metodo_pago AS "paymentMethod", nivel_alerta AS "alertLevel"
       FROM transacciones WHERE id = $1 AND usuario_id = $2
       FOR UPDATE`,
      [transactionId, userId],
    );
    return rows[0] ?? null;
  }

  async insert(
    manager: EntityManager,
    transaction: Partial<Transaction>,
  ): Promise<string> {
    const result = await manager.insert(Transaction, transaction);
    return String(result.identifiers[0].id);
  }

  /**
   * Para el proceso de recurrentes: no hace nada si esa ocurrencia ya se
   * generó (índice único recurrente_id + fecha). null en ese caso.
   */
  async insertIfAbsent(
    manager: EntityManager,
    transaction: GeneratedTransaction,
  ): Promise<string | null> {
    const rows: { id: string }[] = await manager.query(
      `INSERT INTO transacciones (usuario_id, categoria_id, cuenta_id, tarjeta_id, recurrente_id,
                                  tipo_flujo, subtipo, monto, fecha, concepto, metodo_pago, nivel_alerta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (recurrente_id, fecha) WHERE recurrente_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        transaction.userId,
        transaction.categoryId,
        transaction.accountId,
        transaction.cardId,
        transaction.recurringTransactionId,
        transaction.type,
        transaction.subtype,
        transaction.amount,
        transaction.date,
        transaction.concept,
        transaction.paymentMethod,
        transaction.alertLevel,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async update(
    manager: EntityManager,
    transactionId: string,
    changes: Partial<Transaction>,
  ): Promise<void> {
    await manager.update(
      Transaction,
      { id: transactionId },
      { ...changes, updatedAt: () => 'now()' },
    );
  }

  async delete(userId: string, transactionId: string): Promise<boolean> {
    const result = await this.dataSource.manager.delete(Transaction, {
      id: transactionId,
      userId,
    });
    return result.affected === 1;
  }
}
