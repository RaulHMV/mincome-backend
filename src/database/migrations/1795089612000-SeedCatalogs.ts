import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §7: planes y categorías del sistema.
 *
 * - Los planes se llaman igual que los grupos de Cognito (§5): 'normal' en
 *   lugar del 'gratuito' del diccionario.
 * - Los límites y el precio de premium son los de ejemplo del contrato; falta
 *   que producto los defina.
 * - Las categorías van en el orden del documento, así sus id coinciden con los
 *   ejemplos del contrato (Comida = 1, Transporte = 4, Nómina = 11).
 */
export class SeedCatalogs1795089612000 implements MigrationInterface {
  name = 'SeedCatalogs1795089612000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE planes SET nombre = 'normal' WHERE nombre = 'gratuito';

      INSERT INTO planes (nombre, limite_consultas_mes, limite_tokens_mes, precio_mensual, incluye_asistente)
      VALUES
        ('normal', 0, 0, 0, false),
        ('premium', 100, 200000, 79.00, true)
      ON CONFLICT (nombre) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO categorias (nombre, tipo_aplicable, icono, es_sistema)
      VALUES
        ('Comida', 'gasto', 'utensils-crossed', true),
        ('Supermercado', 'gasto', 'shopping-cart', true),
        ('Compras', 'gasto', 'shopping-bag', true),
        ('Transporte', 'gasto', 'car', true),
        ('Servicios', 'gasto', 'zap', true),
        ('Hogar', 'gasto', 'house', true),
        ('Educación', 'gasto', 'graduation-cap', true),
        ('Salud', 'gasto', 'heart-pulse', true),
        ('Entretenimiento', 'gasto', 'clapperboard', true),
        ('Otro', 'gasto', 'more-horizontal', true),
        ('Nómina', 'ingreso', 'briefcase', true),
        ('Negocio / Ventas', 'ingreso', 'store', true),
        ('Honorarios', 'ingreso', 'file-text', true),
        ('Rendimientos', 'ingreso', 'trending-up', true),
        ('Reembolso', 'ingreso', 'rotate-ccw', true),
        ('Otros', 'ingreso', 'more-horizontal', true)
      ON CONFLICT DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM categorias WHERE es_sistema;
      DELETE FROM planes WHERE nombre IN ('normal', 'premium');
    `);
  }
}
