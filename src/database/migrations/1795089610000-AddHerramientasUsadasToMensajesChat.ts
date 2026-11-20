import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-ia.md §6: qué herramientas usó cada respuesta de Piggy, para
 * depurar y para la batería de prompts.
 */
export class AddHerramientasUsadasToMensajesChat1795089610000 implements MigrationInterface {
  name = 'AddHerramientasUsadasToMensajesChat1795089610000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mensajes_chat ADD COLUMN herramientas_usadas TEXT[] NOT NULL DEFAULT '{}'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE mensajes_chat DROP COLUMN herramientas_usadas`,
    );
  }
}
