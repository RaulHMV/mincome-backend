import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AiQuota } from './ai-quota.entity';

export interface AiUsageRow {
  period: string;
  queriesUsed: number;
  tokensUsed: number;
}

/** Consumo mensual de Piggy (requerimientos-ia.md §7). */
@Injectable()
export class AiQuotasRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findUsage(userId: string, period: string): Promise<AiUsageRow> {
    const quota = await this.dataSource.manager.findOneBy(AiQuota, {
      userId,
      period,
    });
    return {
      period,
      queriesUsed: quota?.queriesUsed ?? 0,
      tokensUsed: quota?.tokensUsed ?? 0,
    };
  }

  /**
   * Reserva una consulta en un solo paso, para que dos mensajes simultáneos no
   * rebasen el tope. null: ya no quedan consultas o tokens este mes.
   */
  async reserveQuery(
    manager: EntityManager,
    userId: string,
    period: string,
    limits: { queries: number; tokens: number },
  ): Promise<AiUsageRow | null> {
    if (limits.queries <= 0 || limits.tokens <= 0) {
      return null;
    }
    const rows: { consultas_usadas: number; tokens_usados: number }[] =
      await manager.query(
        `INSERT INTO cuotas_ia (usuario_id, periodo, consultas_usadas)
       VALUES ($1, $2, 1)
       ON CONFLICT (usuario_id, periodo) DO UPDATE
         SET consultas_usadas = cuotas_ia.consultas_usadas + 1,
             actualizado_en = now()
         WHERE cuotas_ia.consultas_usadas < $3
           AND cuotas_ia.tokens_usados < $4
       RETURNING consultas_usadas, tokens_usados`,
        [userId, period, limits.queries, limits.tokens],
      );
    const row = rows[0];
    return row
      ? {
          period,
          queriesUsed: row.consultas_usadas,
          tokensUsed: row.tokens_usados,
        }
      : null;
  }

  /** Devuelve la consulta de un turno que falló. */
  async refundQuery(
    manager: EntityManager,
    userId: string,
    period: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE cuotas_ia
       SET consultas_usadas = GREATEST(consultas_usadas - 1, 0), actualizado_en = now()
       WHERE usuario_id = $1 AND periodo = $2`,
      [userId, period],
    );
  }

  async addTokens(
    manager: EntityManager,
    userId: string,
    period: string,
    tokens: number,
  ): Promise<AiUsageRow> {
    const rows: { consultas_usadas: number; tokens_usados: number }[] =
      await manager.query(
        `INSERT INTO cuotas_ia (usuario_id, periodo, tokens_usados)
       VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id, periodo) DO UPDATE
         SET tokens_usados = cuotas_ia.tokens_usados + EXCLUDED.tokens_usados,
             actualizado_en = now()
       RETURNING consultas_usadas, tokens_usados`,
        [userId, period, tokens],
      );
    return {
      period,
      queriesUsed: rows[0].consultas_usadas,
      tokensUsed: rows[0].tokens_usados,
    };
  }
}
