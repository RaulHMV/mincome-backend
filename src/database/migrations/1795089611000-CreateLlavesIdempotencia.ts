import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registros de @nestjs/idempotency para el encabezado Idempotency-Key
 * (contrato §1, "Escrituras"): un candado mientras corre la petición o la
 * respuesta ya guardada. Es la tabla de la guía de Nest, con nombres en
 * español.
 *
 * - llave_hash: SHA-256 de la llave, que puede ser más larga de lo que admite
 *   una entrada de índice.
 * - respuesta: json y no jsonb, porque jsonb rechaza "\u0000" dentro de un texto.
 * - expira_en: milisegundos desde epoch.
 */
export class CreateLlavesIdempotencia1795089611000 implements MigrationInterface {
  name = 'CreateLlavesIdempotencia1795089611000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE llaves_idempotencia (
        llave_hash  TEXT   NOT NULL,
        llave       TEXT   NOT NULL,
        huella      TEXT   NOT NULL,
        propietario TEXT,
        respuesta   JSON,
        expira_en   BIGINT NOT NULL,
        CONSTRAINT pk_llaves_idempotencia PRIMARY KEY (llave_hash)
      );
      CREATE INDEX idx_llaves_idempotencia_expira_en ON llaves_idempotencia (expira_en);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE llaves_idempotencia`);
  }
}
