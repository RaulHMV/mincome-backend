import { Injectable } from '@nestjs/common';
import {
  IdempotencyStorage,
  type IdempotencyAcquireResult,
  type IdempotencyStore,
  type IdempotencyStoredPayload,
} from '@nestjs/idempotency';
import { createHash } from 'node:crypto';
import { DataSource, MoreThan } from 'typeorm';
import { IdempotencyKey } from './idempotency-key.entity';

/**
 * Guarda los registros de Idempotency-Key en PostgreSQL. Es el store para
 * TypeORM de la guía de @nestjs/idempotency: cada método es una sola
 * sentencia, así que las garantías se cumplen con cualquier número de
 * instancias de la Lambda.
 */
@Injectable()
export class TypeOrmIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly dataSource: DataSource,
    storage: IdempotencyStorage,
  ) {
    storage.registerSource(this);
  }

  async acquire(
    key: string,
    owner: string,
    fingerprint: string,
    lockTtl: number,
  ): Promise<IdempotencyAcquireResult> {
    const keyHash = hashOf(key);
    // Una segunda vuelta solo pasa si la fila se liberó o expiró entre las
    // dos sentencias de abajo.
    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now();
      // Inserta el candado o toma una fila expirada. De varias llamadas a la
      // vez, PostgreSQL deja escribir a una y revisa la condición de las demás
      // contra la fila ganadora: esas no reciben fila de regreso.
      const { raw } = await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(IdempotencyKey)
        .values({
          keyHash,
          key,
          fingerprint,
          owner,
          response: null,
          expiresAt: now + lockTtl,
        })
        .orUpdate(
          ['huella', 'propietario', 'respuesta', 'expira_en'],
          ['llave_hash'],
          {
            overwriteCondition: {
              where: 'llaves_idempotencia.expira_en <= :now',
              parameters: { now },
            },
          },
        )
        .returning(['llave_hash'])
        .updateEntity(false)
        .execute();
      if ((raw as unknown[]).length === 1) {
        return { state: 'acquired' };
      }

      // Otra petición tiene la llave: se reporta su candado o su respuesta.
      const row = await this.dataSource.manager.findOneBy(IdempotencyKey, {
        keyHash,
      });
      if (row && row.expiresAt > now) {
        return row.response === null
          ? { state: 'in-flight', fingerprint: row.fingerprint }
          : {
              state: 'completed',
              fingerprint: row.fingerprint,
              response: row.response as IdempotencyStoredPayload,
            };
      }
    }
    throw new Error(
      `The idempotency record for "${key}" kept changing; try again`,
    );
  }

  async complete(
    key: string,
    owner: string,
    response: IdempotencyStoredPayload,
    ttl: number,
  ): Promise<boolean> {
    const now = Date.now();
    const { affected } = await this.dataSource.manager.update(
      IdempotencyKey,
      ownedBy(key, owner, now),
      { owner: null, response, expiresAt: now + ttl },
    );
    return affected === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const { affected } = await this.dataSource.manager.delete(
      IdempotencyKey,
      ownedBy(key, owner, Date.now()),
    );
    return affected === 1;
  }

  async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    const now = Date.now();
    const { affected } = await this.dataSource.manager.update(
      IdempotencyKey,
      ownedBy(key, owner, now),
      { expiresAt: now + lockTtl },
    );
    return affected === 1;
  }

  /**
   * Borra hasta `limit` registros expirados; lo llama el proceso diario. Los
   * expirados ya se ignoran y la siguiente petición con la misma llave los
   * reutiliza, así que esto solo libera espacio.
   */
  async prune(limit = 1000): Promise<number> {
    const expired = this.dataSource.manager
      .createQueryBuilder(IdempotencyKey, 'expirada')
      .select('expirada.keyHash')
      .where('expirada.expiresAt <= :now')
      .limit(limit);
    const { affected } = await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(IdempotencyKey)
      .where(`llave_hash IN (${expired.getQuery()})`)
      // Vuelve a revisar la expiración: una fila que se tomó después de la
      // subconsulta se queda.
      .andWhere('expira_en <= :now', { now: Date.now() })
      .execute();
    return affected ?? 0;
  }
}

/** El candado de quien llama, si todavía lo tiene y no ha expirado. */
function ownedBy(key: string, owner: string, now: number) {
  return { keyHash: hashOf(key), owner, expiresAt: MoreThan(now) };
}

function hashOf(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
