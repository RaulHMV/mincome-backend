import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { toCents } from '../common/money';

export interface EffectiveBudgetRow {
  id: string;
  categoryId: number;
  categoryName: string;
  categoryIcon: string | null;
  limit: string;
  alertThreshold: number;
  isActive: boolean;
  effectiveFrom: string;
}

export interface BudgetVersion {
  categoryId: number;
  /** Primer día del mes. */
  effectiveFrom: string;
  limit: string;
  alertThreshold: number;
  isActive: boolean;
}

@Injectable()
export class BudgetsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * El presupuesto de cada categoría para el mes: la fila con el
   * vigente_desde más reciente que no pase del mes (requerimientos-backend.md §2.5).
   */
  findEffective(
    userId: string,
    monthStart: string,
    options: { categoryIds?: number[]; includeInactive?: boolean } = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<EffectiveBudgetRow[]> {
    return manager.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (p.categoria_id)
                p.id, p.categoria_id AS "categoryId", c.nombre AS "categoryName",
                c.icono AS "categoryIcon", p.monto_limite::text AS "limit",
                p.umbral_alerta AS "alertThreshold", p.activo AS "isActive",
                p.vigente_desde::text AS "effectiveFrom"
         FROM presupuestos p
         JOIN categorias c ON c.id = p.categoria_id
         WHERE p.usuario_id = $1 AND p.vigente_desde <= $2
           AND ($3::int[] IS NULL OR p.categoria_id = ANY($3))
         ORDER BY p.categoria_id, p.vigente_desde DESC
       ) vigente
       WHERE $4 OR vigente."isActive"`,
      [
        userId,
        monthStart,
        options.categoryIds ?? null,
        options.includeInactive ?? false,
      ],
    );
  }

  /** Gasto del mes por categoría (requerimientos-backend.md §3.2). */
  async spentByCategory(
    manager: EntityManager,
    userId: string,
    month: { start: string; end: string },
    options: { categoryIds?: number[]; excludeTransactionId?: string } = {},
  ): Promise<Map<number, number>> {
    const rows: { categoryId: number; spent: string }[] = await manager.query(
      `SELECT categoria_id AS "categoryId", SUM(monto)::text AS spent
       FROM transacciones
       WHERE usuario_id = $1 AND tipo_flujo = 'gasto'
         AND fecha BETWEEN $2 AND $3
         AND ($4::int[] IS NULL OR categoria_id = ANY($4))
         AND ($5::uuid IS NULL OR id <> $5)
       GROUP BY categoria_id`,
      [
        userId,
        month.start,
        month.end,
        options.categoryIds ?? null,
        options.excludeTransactionId ?? null,
      ],
    );
    return new Map(rows.map((row) => [row.categoryId, toCents(row.spent)]));
  }

  /**
   * Bloquea la fila del presupuesto: si llegan dos gastos de la misma
   * categoría a la vez, solo uno cruza el umbral (requerimientos-backend.md §3.3).
   */
  async lock(manager: EntityManager, budgetId: string): Promise<void> {
    await manager.query(
      `SELECT id FROM presupuestos WHERE id = $1 FOR UPDATE`,
      [budgetId],
    );
  }

  async upsertVersion(
    manager: EntityManager,
    userId: string,
    version: BudgetVersion,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO presupuestos (usuario_id, categoria_id, monto_limite, umbral_alerta, activo, vigente_desde)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (usuario_id, categoria_id, vigente_desde) DO UPDATE
         SET monto_limite = EXCLUDED.monto_limite,
             umbral_alerta = EXCLUDED.umbral_alerta,
             activo = EXCLUDED.activo,
             actualizado_en = now()`,
      [
        userId,
        version.categoryId,
        version.limit,
        version.alertThreshold,
        version.isActive,
        version.effectiveFrom,
      ],
    );
  }
}
