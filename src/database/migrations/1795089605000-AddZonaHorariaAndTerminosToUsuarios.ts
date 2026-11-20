import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.6 y §2.7: la zona horaria decide qué es "hoy" y
 * "este mes" para cada usuario, y los términos guardan qué versión aceptó y
 * cuándo.
 */
export class AddZonaHorariaAndTerminosToUsuarios1795089605000 implements MigrationInterface {
  name = 'AddZonaHorariaAndTerminosToUsuarios1795089605000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE usuarios
        ADD COLUMN zona_horaria          VARCHAR(40) NOT NULL DEFAULT 'America/Mexico_City',
        ADD COLUMN terminos_version      VARCHAR(20),
        ADD COLUMN terminos_aceptados_en TIMESTAMPTZ,
        ADD CONSTRAINT ck_usuarios_terminos
          CHECK ((terminos_version IS NULL) = (terminos_aceptados_en IS NULL));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE usuarios
        DROP CONSTRAINT ck_usuarios_terminos,
        DROP COLUMN terminos_aceptados_en,
        DROP COLUMN terminos_version,
        DROP COLUMN zona_horaria;
    `);
  }
}
