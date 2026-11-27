import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { DbAccountType, DbPocketMovementType } from '../common/enums';
import type { PageRequest } from '../common/pagination';
import { offsetOf } from '../common/pagination';
import { Pocket } from './pocket.entity';
import { PocketMovement } from './pocket-movement.entity';

const POCKET_COLUMNS = `id, usuario_id AS "userId", nombre AS name, saldo::text AS balance,
  meta_monto::text AS "targetAmount", fecha_meta::text AS "targetDate", color_hex AS "colorHex",
  icono AS icon, activo AS "isActive", creado_en AS "createdAt", actualizado_en AS "updatedAt"`;

/** Fila de `apartados` leída con SQL: un objeto plano, no una instancia de la entidad. */
export type PocketRow = Pick<
  Pocket,
  | 'id'
  | 'userId'
  | 'name'
  | 'balance'
  | 'targetAmount'
  | 'targetDate'
  | 'colorHex'
  | 'icon'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

export interface PocketMovementViewRow {
  id: string;
  pocketId: string;
  type: DbPocketMovementType;
  amount: string;
  date: string;
  note: string | null;
  createdAt: Date;
  accountId: string;
  accountName: string;
  accountType: DbAccountType;
}

const MOVEMENT_VIEW_SELECT = `
  SELECT m.id, m.apartado_id AS "pocketId", m.tipo AS type, m.monto::text AS amount,
         m.fecha::text AS date, m.nota AS note, m.creado_en AS "createdAt",
         c.id AS "accountId", c.nombre AS "accountName", c.tipo AS "accountType"
  FROM movimientos_apartado m
  JOIN cuentas c ON c.id = m.cuenta_id`;

@Injectable()
export class PocketsRepository {
  constructor(private readonly dataSource: DataSource) {}

  findForUser(userId: string, isActive: boolean | null): Promise<PocketRow[]> {
    return this.dataSource.query(
      `SELECT ${POCKET_COLUMNS} FROM apartados
       WHERE usuario_id = $1 AND ($2::boolean IS NULL OR activo = $2)
       ORDER BY activo DESC, creado_en, id`,
      [userId, isActive],
    );
  }

  async findOwned(
    userId: string,
    pocketId: string,
    manager: EntityManager = this.dataSource.manager,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<PocketRow | null> {
    const rows: PocketRow[] = await manager.query(
      `SELECT ${POCKET_COLUMNS} FROM apartados WHERE id = $1 AND usuario_id = $2
       ${lock ? 'FOR UPDATE' : ''}`,
      [pocketId, userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Cuántos apartados activos tiene, con la fila del usuario bloqueada hasta
   * el final de la transacción: dos altas simultáneas se forman y la segunda
   * cuenta lo que la primera ya guardó. Bloquear solo los apartados activos no
   * basta, porque no detiene las filas nuevas. FOR NO KEY UPDATE no estorba a
   * las FK que apuntan a usuarios.
   */
  async countActiveLockingOwner(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    await manager.query(
      `SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE`,
      [userId],
    );
    const [{ total }]: { total: number }[] = await manager.query(
      `SELECT count(*)::int AS total FROM apartados WHERE usuario_id = $1 AND activo`,
      [userId],
    );
    return total;
  }

  /** Nombre único entre los activos, sin distinguir mayúsculas, igual que el índice uq_apartados_usuario_id_nombre. */
  async isNameTaken(
    manager: EntityManager,
    userId: string,
    name: string,
    exceptId: string | null,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM apartados
       WHERE usuario_id = $1 AND activo AND lower(nombre) = lower($2)
         AND ($3::uuid IS NULL OR id <> $3)
       LIMIT 1`,
      [userId, name, exceptId],
    );
    return rows.length > 0;
  }

  insert(manager: EntityManager, pocket: Partial<Pocket>): Promise<string> {
    return manager
      .insert(Pocket, pocket)
      .then((result) => String(result.identifiers[0].id));
  }

  async update(
    manager: EntityManager,
    pocketId: string,
    changes: Partial<Pocket>,
  ): Promise<void> {
    await manager.update(
      Pocket,
      { id: pocketId },
      { ...changes, updatedAt: () => 'now()' },
    );
  }

  async addToBalance(
    manager: EntityManager,
    pocketId: string,
    amount: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE apartados SET saldo = saldo + $2, actualizado_en = now() WHERE id = $1`,
      [pocketId, amount],
    );
  }

  /**
   * Resta del saldo solo si alcanza, en la misma sentencia: dos retiros
   * simultáneos no pueden dejarlo negativo (requerimientos-backend.md §3.4).
   */
  async subtractFromBalance(
    manager: EntityManager,
    pocketId: string,
    amount: string,
  ): Promise<boolean> {
    // Con UPDATE, query() de TypeORM regresa [filas, filas afectadas].
    const [, affected]: [unknown[], number] = await manager.query(
      `UPDATE apartados SET saldo = saldo - $2, actualizado_en = now()
       WHERE id = $1 AND saldo >= $2`,
      [pocketId, amount],
    );
    return affected === 1;
  }

  async insertMovement(
    manager: EntityManager,
    movement: Partial<PocketMovement>,
  ): Promise<string> {
    const result = await manager.insert(PocketMovement, movement);
    return String(result.identifiers[0].id);
  }

  async findMovementView(
    manager: EntityManager,
    movementId: string,
  ): Promise<PocketMovementViewRow | null> {
    const rows: PocketMovementViewRow[] = await manager.query(
      `${MOVEMENT_VIEW_SELECT} WHERE m.id = $1`,
      [movementId],
    );
    return rows[0] ?? null;
  }

  /** El más reciente primero. */
  async findMovementsPage(
    pocketId: string,
    page: PageRequest,
  ): Promise<{ rows: PocketMovementViewRow[]; total: number }> {
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `${MOVEMENT_VIEW_SELECT}
         WHERE m.apartado_id = $1
         ORDER BY m.fecha DESC, m.creado_en DESC, m.id DESC
         LIMIT $2 OFFSET $3`,
        [pocketId, page.pageSize, offsetOf(page)],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM movimientos_apartado WHERE apartado_id = $1`,
        [pocketId],
      ),
    ]);
    return { rows, total };
  }
}
