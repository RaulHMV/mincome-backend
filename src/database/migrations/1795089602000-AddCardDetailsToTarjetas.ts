import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.3: límite de crédito, terminación y banco; el
 * corte y la fecha de pago solo existen en crédito; alias y banco + terminación
 * únicos entre las tarjetas activas, sin distinguir mayúsculas.
 */
export class AddCardDetailsToTarjetas1795089602000 implements MigrationInterface {
  name = 'AddCardDetailsToTarjetas1795089602000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tarjetas
        ADD COLUMN limite_credito NUMERIC(12,2),
        ADD COLUMN terminacion    CHAR(4),
        ADD COLUMN banco          VARCHAR(50),
        ALTER COLUMN dia_corte       DROP NOT NULL,
        ALTER COLUMN dia_limite_pago DROP NOT NULL,
        ADD CONSTRAINT ck_tarjetas_limite_credito CHECK (limite_credito > 0),
        ADD CONSTRAINT ck_tarjetas_terminacion CHECK (terminacion ~ '^[0-9]{4}$');

      -- Una tarjeta de débito no tiene corte ni fecha de pago.
      UPDATE tarjetas SET dia_corte = NULL, dia_limite_pago = NULL WHERE tipo_tarjeta = 'debito';

      -- NOT VALID: el límite de una tarjeta de crédito que ya exista no se puede
      -- inventar. La regla aplica a toda fila nueva o modificada; cuando las que
      -- ya existían tengan su límite: VALIDATE CONSTRAINT ck_tarjetas_por_tipo.
      ALTER TABLE tarjetas ADD CONSTRAINT ck_tarjetas_por_tipo CHECK (
        (tipo_tarjeta = 'credito' AND limite_credito IS NOT NULL AND dia_corte IS NOT NULL AND dia_limite_pago IS NOT NULL)
        OR
        (tipo_tarjeta = 'debito' AND limite_credito IS NULL AND dia_corte IS NULL AND dia_limite_pago IS NULL)
      ) NOT VALID;

      ALTER TABLE tarjetas DROP CONSTRAINT uq_tarjetas_usuario_id_alias;
      CREATE UNIQUE INDEX uq_tarjetas_usuario_id_alias
        ON tarjetas (usuario_id, lower(alias)) WHERE activa;
      CREATE UNIQUE INDEX uq_tarjetas_usuario_id_banco_terminacion
        ON tarjetas (usuario_id, lower(banco), terminacion) WHERE activa;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX uq_tarjetas_usuario_id_banco_terminacion;
      DROP INDEX uq_tarjetas_usuario_id_alias;
      ALTER TABLE tarjetas
        ADD CONSTRAINT uq_tarjetas_usuario_id_alias UNIQUE (usuario_id, alias),
        DROP CONSTRAINT ck_tarjetas_por_tipo;
      UPDATE tarjetas SET dia_corte = 1, dia_limite_pago = 1 WHERE dia_corte IS NULL;
      ALTER TABLE tarjetas
        ALTER COLUMN dia_corte SET NOT NULL,
        ALTER COLUMN dia_limite_pago SET NOT NULL,
        DROP COLUMN banco,
        DROP COLUMN terminacion,
        DROP COLUMN limite_credito;
    `);
  }
}
