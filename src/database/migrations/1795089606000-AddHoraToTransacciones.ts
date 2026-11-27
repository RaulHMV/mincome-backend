import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.8 (decisión D10): hora opcional del movimiento.
 * fecha sigue mandando en todo lo mensual.
 */
export class AddHoraToTransacciones1795089606000 implements MigrationInterface {
  name = 'AddHoraToTransacciones1795089606000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE transacciones ADD COLUMN hora TIME`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE transacciones DROP COLUMN hora`);
  }
}
