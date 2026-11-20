import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type {
  DbAccountType,
  DbCardType,
  DbFlowSubtype,
  DbFlowType,
  DbFrequency,
  DbPaymentMethod,
} from '../common/enums';
import { RecurringTransaction } from './recurring-transaction.entity';

export interface RecurringTransactionViewRow {
  id: string;
  type: DbFlowType;
  subtype: DbFlowSubtype;
  amount: string;
  concept: string;
  paymentMethod: DbPaymentMethod;
  frequency: DbFrequency;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  isActive: boolean;
  createdAt: Date;
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

const VIEW_SELECT = `
  SELECT r.id, r.tipo_flujo AS type, r.subtipo AS subtype, r.monto::text AS amount, r.concepto AS concept,
         r.metodo_pago AS "paymentMethod", r.frecuencia AS frequency, r.dia_ejecucion AS "dayOfMonth",
         r.fecha_inicio::text AS "startDate", r.fecha_fin::text AS "endDate",
         r.proxima_ejecucion::text AS "nextRunDate", r.activa AS "isActive", r.creado_en AS "createdAt",
         cat.id AS "categoryId", cat.nombre AS "categoryName", cat.icono AS "categoryIcon",
         c.id AS "accountId", c.nombre AS "accountName", c.tipo AS "accountType",
         tj.id AS "cardId", tj.alias AS "cardAlias", tj.terminacion AS "cardLast4", tj.tipo_tarjeta AS "cardType"
  FROM transacciones_recurrentes r
  JOIN categorias cat ON cat.id = r.categoria_id
  JOIN cuentas c ON c.id = r.cuenta_id
  LEFT JOIN tarjetas tj ON tj.id = r.tarjeta_id`;

const TEMPLATE_COLUMNS = `id, usuario_id AS "userId", categoria_id AS "categoryId", cuenta_id AS "accountId",
  tarjeta_id AS "cardId", tipo_flujo AS type, subtipo AS subtype, monto::text AS amount,
  concepto AS concept, metodo_pago AS "paymentMethod", frecuencia AS frequency,
  dia_ejecucion AS "dayOfMonth", fecha_inicio::text AS "startDate", fecha_fin::text AS "endDate",
  proxima_ejecucion::text AS "nextRunDate", activa AS "isActive"`;

@Injectable()
export class RecurringTransactionsRepository {
  constructor(private readonly dataSource: DataSource) {}

  findViews(
    userId: string,
    isActive: boolean | null,
  ): Promise<RecurringTransactionViewRow[]> {
    return this.dataSource.query(
      `${VIEW_SELECT}
       WHERE r.usuario_id = $1 AND ($2::boolean IS NULL OR r.activa = $2)
       ORDER BY r.activa DESC, r.proxima_ejecucion NULLS LAST, lower(r.concepto), r.id`,
      [userId, isActive],
    );
  }

  async findView(
    userId: string,
    recurringTransactionId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<RecurringTransactionViewRow | null> {
    const rows: RecurringTransactionViewRow[] = await manager.query(
      `${VIEW_SELECT} WHERE r.id = $1 AND r.usuario_id = $2`,
      [recurringTransactionId, userId],
    );
    return rows[0] ?? null;
  }

  /** La plantilla bloqueada: el proceso diario y una edición no la procesan a la vez. */
  async findForUpdate(
    manager: EntityManager,
    recurringTransactionId: string,
    userId?: string,
  ): Promise<RecurringTransaction | null> {
    const rows: RecurringTransaction[] = await manager.query(
      `SELECT ${TEMPLATE_COLUMNS} FROM transacciones_recurrentes
       WHERE id = $1 AND ($2::uuid IS NULL OR usuario_id = $2)
       FOR UPDATE`,
      [recurringTransactionId, userId ?? null],
    );
    return rows[0] ?? null;
  }

  async insert(
    manager: EntityManager,
    template: Partial<RecurringTransaction>,
  ): Promise<string> {
    const result = await manager.insert(RecurringTransaction, template);
    return String(result.identifiers[0].id);
  }

  async update(
    manager: EntityManager,
    recurringTransactionId: string,
    changes: Partial<RecurringTransaction>,
  ): Promise<void> {
    await manager.update(
      RecurringTransaction,
      { id: recurringTransactionId },
      { ...changes, updatedAt: () => 'now()' },
    );
  }

  /**
   * Plantillas activas cuya siguiente ocurrencia ya llegó en el "hoy" de su
   * usuario (requerimientos-backend.md §3.7), con la zona horaria para
   * calcularlo igual en JavaScript.
   */
  findDue(
    limit: number,
    exceptIds: string[],
  ): Promise<{ id: string; timeZone: string }[]> {
    return this.dataSource.query(
      `SELECT r.id, u.zona_horaria AS "timeZone"
       FROM transacciones_recurrentes r
       JOIN usuarios u ON u.id = r.usuario_id
       WHERE r.activa AND r.proxima_ejecucion <= (now() AT TIME ZONE u.zona_horaria)::date
         AND NOT (r.id = ANY($2::uuid[]))
       ORDER BY r.proxima_ejecucion, r.id
       LIMIT $1`,
      [limit, exceptIds],
    );
  }
}
