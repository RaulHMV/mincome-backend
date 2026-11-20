import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.9: las alertas se calculan al vuelo; esta tabla
 * solo guarda cuáles ya leyó el usuario. clave es el id de la alerta
 * ('budget:<id>:2026-10'), así la misma alerta no se repite.
 */
export class CreateNotificaciones1795089607000 implements MigrationInterface {
  name = 'CreateNotificaciones1795089607000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notificaciones (
        id         UUID         NOT NULL DEFAULT gen_random_uuid(),
        usuario_id UUID         NOT NULL,
        tipo       VARCHAR(30)  NOT NULL,
        datos      JSONB        NOT NULL,
        clave      VARCHAR(120) NOT NULL,
        leida_en   TIMESTAMPTZ,
        creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pk_notificaciones PRIMARY KEY (id),
        CONSTRAINT fk_notificaciones_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT uq_notificaciones_usuario_id_clave UNIQUE (usuario_id, clave)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notificaciones`);
  }
}
