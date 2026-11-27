import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.4: una regla por frecuencia, anclada en
 * fecha_inicio. dia_ejecucion solo aplica en 'mensual'; proxima_ejecucion
 * guarda la siguiente ocurrencia (nula cuando la plantilla terminó), y el
 * índice único evita generar el mismo movimiento dos veces.
 */
export class AddRecurrenceRulesToTransaccionesRecurrentes1795089603000 implements MigrationInterface {
  name = 'AddRecurrenceRulesToTransaccionesRecurrentes1795089603000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transacciones_recurrentes ADD COLUMN proxima_ejecucion DATE;

      UPDATE transacciones_recurrentes
      SET dia_ejecucion = CASE frecuencia
            WHEN 'mensual' THEN COALESCE(dia_ejecucion, EXTRACT(DAY FROM fecha_inicio)::smallint)
          END,
          -- Si ya hubiera datos, el proceso diario alcanza las ocurrencias desde el inicio.
          proxima_ejecucion = CASE WHEN activa THEN fecha_inicio END;

      ALTER TABLE transacciones_recurrentes
        ADD CONSTRAINT ck_transacciones_recurrentes_dia_ejecucion_frecuencia
          CHECK ((frecuencia = 'mensual') = (dia_ejecucion IS NOT NULL));

      CREATE UNIQUE INDEX uq_transacciones_recurrente_id_fecha
        ON transacciones (recurrente_id, fecha)
        WHERE recurrente_id IS NOT NULL;

      CREATE INDEX idx_transacciones_recurrentes_proxima_ejecucion
        ON transacciones_recurrentes (proxima_ejecucion)
        WHERE activa;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX idx_transacciones_recurrentes_proxima_ejecucion;
      DROP INDEX uq_transacciones_recurrente_id_fecha;
      ALTER TABLE transacciones_recurrentes
        DROP CONSTRAINT ck_transacciones_recurrentes_dia_ejecucion_frecuencia,
        DROP COLUMN proxima_ejecucion;
    `);
  }
}
