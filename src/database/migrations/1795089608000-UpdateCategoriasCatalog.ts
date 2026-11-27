import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.10: una categoría con movimientos no se borra,
 * se oculta (activa = false), y es_sistema ya no puede contradecir a
 * usuario_id. icono guarda una clave ('car', 'utensils-crossed'), no un SVG.
 */
export class UpdateCategoriasCatalog1795089608000 implements MigrationInterface {
  name = 'UpdateCategoriasCatalog1795089608000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE categorias SET es_sistema = (usuario_id IS NULL);

      ALTER TABLE categorias
        ADD COLUMN activa BOOLEAN NOT NULL DEFAULT true,
        ADD CONSTRAINT ck_categorias_es_sistema CHECK (es_sistema = (usuario_id IS NULL));

      COMMENT ON COLUMN categorias.icono IS 'Clave del ícono (nombre de Lucide), no el SVG';
      COMMENT ON COLUMN apartados.icono IS 'Clave del ícono del selector de Apartados';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      COMMENT ON COLUMN apartados.icono IS NULL;
      COMMENT ON COLUMN categorias.icono IS NULL;
      ALTER TABLE categorias
        DROP CONSTRAINT ck_categorias_es_sistema,
        DROP COLUMN activa;
    `);
  }
}
