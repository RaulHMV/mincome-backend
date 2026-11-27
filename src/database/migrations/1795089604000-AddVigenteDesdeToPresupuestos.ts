import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.5: cada límite tiene vigencia. El límite de un
 * mes es la fila con el vigente_desde más reciente que no pase de ese mes, así
 * que cambiar el límite en noviembre no reescribe octubre.
 */
export class AddVigenteDesdeToPresupuestos1795089604000 implements MigrationInterface {
  name = 'AddVigenteDesdeToPresupuestos1795089604000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE presupuestos
        ADD COLUMN vigente_desde DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date;

      UPDATE presupuestos SET vigente_desde = date_trunc('month', creado_en)::date;

      ALTER TABLE presupuestos
        DROP CONSTRAINT uq_presupuestos_usuario_id_categoria_id,
        ADD CONSTRAINT uq_presupuestos_usuario_id_categoria_id_vigente_desde
          UNIQUE (usuario_id, categoria_id, vigente_desde),
        ADD CONSTRAINT ck_presupuestos_vigente_desde
          CHECK (vigente_desde = date_trunc('month', vigente_desde)::date);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM presupuestos p
      USING presupuestos posterior
      WHERE posterior.usuario_id = p.usuario_id
        AND posterior.categoria_id = p.categoria_id
        AND posterior.vigente_desde > p.vigente_desde;

      ALTER TABLE presupuestos
        DROP CONSTRAINT ck_presupuestos_vigente_desde,
        DROP CONSTRAINT uq_presupuestos_usuario_id_categoria_id_vigente_desde,
        ADD CONSTRAINT uq_presupuestos_usuario_id_categoria_id UNIQUE (usuario_id, categoria_id),
        DROP COLUMN vigente_desde;
    `);
  }
}
