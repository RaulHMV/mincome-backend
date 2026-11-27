import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { centsToNumeric, toCents } from '../common/money';
import type { PageRequest } from '../common/pagination';
import { offsetOf } from '../common/pagination';
import { MovementKind } from './dto/movement.dto';
import type { MovementRow } from './movement.mapper';

export interface MovementFilters {
  /** null: todos. */
  kinds: MovementKind[] | null;
  from?: string;
  to?: string;
  q?: string;
  categoryId?: number;
  /** El valor de la BD: efectivo, debito o credito. */
  accountType?: string;
  accountId?: string;
  cardId?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface MovementTotals {
  total: number;
  incomeCents: number;
  expenseCents: number;
  pocketDepositsCents: number;
  pocketWithdrawalsCents: number;
}

/** LIKE con lo que escribió el usuario como texto literal: `%`, `_` y `\` no son comodines. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Arma los parámetros $1, $2… en el orden en que se usan. */
class Params {
  readonly values: unknown[] = [];

  constructor(userId: string) {
    this.values.push(userId);
  }

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * GET /movements (contrato §3.3): transacciones, movimientos de apartados y
 * traspasos en una sola lista, con los mismos filtros y los totales de todo lo
 * que cumple los filtros. Las tres fuentes regresan las mismas columnas, en el
 * mismo orden y con el mismo tipo, para el UNION ALL.
 */
@Injectable()
export class MovementsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findPage(
    userId: string,
    filters: MovementFilters,
    page: PageRequest,
  ): Promise<MovementRow[]> {
    const params = new Params(userId);
    const union = this.unionSql(params, filters);
    if (union === null) {
      return [];
    }
    const limit = params.add(page.pageSize);
    const offset = params.add(offsetOf(page));
    return this.dataSource.query(
      `SELECT kind, id, date::text AS date, time::text AS time, amount::text AS amount, title, icon,
              category_id AS "categoryId", category_name AS "categoryName", category_icon AS "categoryIcon",
              account_id AS "accountId", account_name AS "accountName", account_type AS "accountType",
              card_id AS "cardId", card_alias AS "cardAlias", card_last4 AS "cardLast4", card_type AS "cardType",
              pocket_id AS "pocketId", pocket_name AS "pocketName", pocket_icon AS "pocketIcon",
              destination_account_id AS "destinationAccountId",
              destination_account_name AS "destinationAccountName",
              destination_account_type AS "destinationAccountType"
       FROM (${union}) movimientos
       ORDER BY date DESC, created_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
  }

  async totals(
    userId: string,
    filters: MovementFilters,
  ): Promise<MovementTotals> {
    const params = new Params(userId);
    const union = this.unionSql(params, filters);
    if (union === null) {
      return {
        total: 0,
        incomeCents: 0,
        expenseCents: 0,
        pocketDepositsCents: 0,
        pocketWithdrawalsCents: 0,
      };
    }
    const [row]: Record<string, string | number>[] =
      await this.dataSource.query(
        `SELECT count(*)::int AS total,
              coalesce(sum(amount) FILTER (WHERE kind = 'income'), 0)::text AS income,
              coalesce(sum(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expense,
              coalesce(sum(amount) FILTER (WHERE kind = 'pocketDeposit'), 0)::text AS "pocketDeposits",
              coalesce(sum(amount) FILTER (WHERE kind = 'pocketWithdrawal'), 0)::text AS "pocketWithdrawals"
       FROM (${union}) movimientos`,
        params.values,
      );
    return {
      total: Number(row.total),
      incomeCents: toCents(row.income),
      expenseCents: toCents(row.expense),
      pocketDepositsCents: toCents(row.pocketDeposits),
      pocketWithdrawalsCents: toCents(row.pocketWithdrawals),
    };
  }

  /** null si ninguna fuente puede cumplir los filtros. */
  private unionSql(params: Params, filters: MovementFilters): string | null {
    const wants = (...kinds: MovementKind[]) =>
      filters.kinds === null ||
      kinds.some((kind) => filters.kinds?.includes(kind));
    const pattern =
      filters.q === undefined
        ? null
        : `sin_acentos(lower(${params.add(containsPattern(filters.q))}::text))`;
    const sources: string[] = [];

    if (wants(MovementKind.INCOME, MovementKind.EXPENSE)) {
      sources.push(this.transactionsSql(params, filters, pattern));
    }
    // La categoría solo existe en transacciones; la tarjeta, en transacciones
    // y en los pagos que entran a su cuenta.
    if (
      wants(MovementKind.POCKET_DEPOSIT, MovementKind.POCKET_WITHDRAWAL) &&
      filters.categoryId === undefined &&
      filters.cardId === undefined
    ) {
      sources.push(this.pocketMovementsSql(params, filters, pattern));
    }
    if (wants(MovementKind.TRANSFER) && filters.categoryId === undefined) {
      sources.push(this.transfersSql(params, filters, pattern));
    }
    return sources.length === 0 ? null : sources.join('\nUNION ALL\n');
  }

  private commonConditions(
    params: Params,
    filters: MovementFilters,
    alias: string,
  ): string[] {
    const conditions = [`${alias}.usuario_id = $1`];
    if (filters.from) {
      conditions.push(`${alias}.fecha >= ${params.add(filters.from)}::date`);
    }
    if (filters.to) {
      conditions.push(`${alias}.fecha <= ${params.add(filters.to)}::date`);
    }
    if (filters.minAmount !== undefined) {
      conditions.push(
        `${alias}.monto >= ${params.add(centsToNumeric(toCents(filters.minAmount)))}::numeric`,
      );
    }
    if (filters.maxAmount !== undefined) {
      conditions.push(
        `${alias}.monto <= ${params.add(centsToNumeric(toCents(filters.maxAmount)))}::numeric`,
      );
    }
    return conditions;
  }

  private transactionsSql(
    params: Params,
    filters: MovementFilters,
    pattern: string | null,
  ): string {
    const conditions = this.commonConditions(params, filters, 't');
    const kinds = filters.kinds;
    if (kinds !== null) {
      const flows = [
        ...(kinds.includes(MovementKind.INCOME) ? [`'ingreso'`] : []),
        ...(kinds.includes(MovementKind.EXPENSE) ? [`'gasto'`] : []),
      ];
      if (flows.length === 1) {
        conditions.push(`t.tipo_flujo = ${flows[0]}`);
      }
    }
    if (filters.categoryId !== undefined) {
      conditions.push(`t.categoria_id = ${params.add(filters.categoryId)}`);
    }
    if (filters.accountType) {
      conditions.push(`c.tipo::text = ${params.add(filters.accountType)}`);
    }
    if (filters.accountId) {
      conditions.push(`t.cuenta_id = ${params.add(filters.accountId)}::uuid`);
    }
    if (filters.cardId) {
      conditions.push(`t.tarjeta_id = ${params.add(filters.cardId)}::uuid`);
    }
    if (pattern) {
      // La primera expresión es la del índice idx_transacciones_busqueda.
      conditions.push(`(
        sin_acentos(lower(t.concepto || ' ' || coalesce(t.alias_comercial, '') || ' ' || coalesce(t.notas, ''))) LIKE ${pattern}
        OR sin_acentos(lower(cat.nombre)) LIKE ${pattern}
        OR sin_acentos(lower(c.nombre)) LIKE ${pattern}
        OR sin_acentos(lower(coalesce(tj.alias, ''))) LIKE ${pattern})`);
    }
    return `
      SELECT CASE t.tipo_flujo WHEN 'ingreso' THEN 'income' ELSE 'expense' END AS kind,
             t.id, t.fecha AS date, t.hora AS time, t.creado_en AS created_at, t.monto AS amount,
             coalesce(t.alias_comercial, t.concepto)::text AS title, cat.icono::text AS icon,
             cat.id AS category_id, cat.nombre::text AS category_name, cat.icono::text AS category_icon,
             c.id AS account_id, c.nombre::text AS account_name, c.tipo::text AS account_type,
             tj.id AS card_id, tj.alias::text AS card_alias, tj.terminacion::text AS card_last4,
             tj.tipo_tarjeta::text AS card_type,
             NULL::uuid AS pocket_id, NULL::text AS pocket_name, NULL::text AS pocket_icon,
             NULL::uuid AS destination_account_id, NULL::text AS destination_account_name,
             NULL::text AS destination_account_type
      FROM transacciones t
      JOIN categorias cat ON cat.id = t.categoria_id
      JOIN cuentas c ON c.id = t.cuenta_id
      LEFT JOIN tarjetas tj ON tj.id = t.tarjeta_id
      WHERE ${conditions.join(' AND ')}`;
  }

  private pocketMovementsSql(
    params: Params,
    filters: MovementFilters,
    pattern: string | null,
  ): string {
    const conditions = this.commonConditions(params, filters, 'm');
    const kinds = filters.kinds;
    if (kinds !== null) {
      const types = [
        ...(kinds.includes(MovementKind.POCKET_DEPOSIT) ? [`'abono'`] : []),
        ...(kinds.includes(MovementKind.POCKET_WITHDRAWAL) ? [`'retiro'`] : []),
      ];
      if (types.length === 1) {
        conditions.push(`m.tipo = ${types[0]}`);
      }
    }
    if (filters.accountType) {
      conditions.push(`c.tipo::text = ${params.add(filters.accountType)}`);
    }
    if (filters.accountId) {
      conditions.push(`m.cuenta_id = ${params.add(filters.accountId)}::uuid`);
    }
    if (pattern) {
      conditions.push(`(
        sin_acentos(lower(a.nombre || ' ' || coalesce(m.nota, ''))) LIKE ${pattern}
        OR sin_acentos(lower(c.nombre)) LIKE ${pattern})`);
    }
    return `
      SELECT CASE m.tipo WHEN 'abono' THEN 'pocketDeposit' ELSE 'pocketWithdrawal' END AS kind,
             m.id, m.fecha AS date, NULL::time AS time, m.creado_en AS created_at, m.monto AS amount,
             a.nombre::text AS title, a.icono::text AS icon,
             NULL::int AS category_id, NULL::text AS category_name, NULL::text AS category_icon,
             c.id AS account_id, c.nombre::text AS account_name, c.tipo::text AS account_type,
             NULL::uuid AS card_id, NULL::text AS card_alias, NULL::text AS card_last4,
             NULL::text AS card_type,
             a.id AS pocket_id, a.nombre::text AS pocket_name, a.icono::text AS pocket_icon,
             NULL::uuid AS destination_account_id, NULL::text AS destination_account_name,
             NULL::text AS destination_account_type
      FROM movimientos_apartado m
      JOIN apartados a ON a.id = m.apartado_id
      JOIN cuentas c ON c.id = m.cuenta_id
      WHERE ${conditions.join(' AND ')}`;
  }

  private transfersSql(
    params: Params,
    filters: MovementFilters,
    pattern: string | null,
  ): string {
    const conditions = this.commonConditions(params, filters, 'tr');
    // Un traspaso toca dos cuentas: cuenta si cualquiera de las dos coincide.
    if (filters.accountType) {
      const type = params.add(filters.accountType);
      conditions.push(`(co.tipo::text = ${type} OR cd.tipo::text = ${type})`);
    }
    if (filters.accountId) {
      const account = params.add(filters.accountId);
      conditions.push(
        `(tr.cuenta_origen_id = ${account}::uuid OR tr.cuenta_destino_id = ${account}::uuid)`,
      );
    }
    if (filters.cardId) {
      // Los pagos de una tarjeta de crédito son traspasos a su cuenta.
      conditions.push(`tr.cuenta_destino_id = (
        SELECT tj.cuenta_id FROM tarjetas tj
        WHERE tj.id = ${params.add(filters.cardId)}::uuid AND tj.usuario_id = $1
          AND tj.tipo_tarjeta = 'credito')`);
    }
    if (pattern) {
      conditions.push(`(
        sin_acentos(lower(co.nombre || ' ' || cd.nombre || ' ' || coalesce(tr.nota, ''))) LIKE ${pattern})`);
    }
    return `
      SELECT 'transfer' AS kind,
             tr.id, tr.fecha AS date, NULL::time AS time, tr.creado_en AS created_at, tr.monto AS amount,
             cd.nombre::text AS title, NULL::text AS icon,
             NULL::int AS category_id, NULL::text AS category_name, NULL::text AS category_icon,
             co.id AS account_id, co.nombre::text AS account_name, co.tipo::text AS account_type,
             NULL::uuid AS card_id, NULL::text AS card_alias, NULL::text AS card_last4,
             NULL::text AS card_type,
             NULL::uuid AS pocket_id, NULL::text AS pocket_name, NULL::text AS pocket_icon,
             cd.id AS destination_account_id, cd.nombre::text AS destination_account_name,
             cd.tipo::text AS destination_account_type
      FROM traspasos tr
      JOIN cuentas co ON co.id = tr.cuenta_origen_id
      JOIN cuentas cd ON cd.id = tr.cuenta_destino_id
      WHERE ${conditions.join(' AND ')}`;
  }
}
