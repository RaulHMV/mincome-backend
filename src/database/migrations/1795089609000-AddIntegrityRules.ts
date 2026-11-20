import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES_OWNED_BY_USER = [
  'categorias',
  'tarjetas',
  'cuentas',
  'transacciones_recurrentes',
  'transacciones',
  'presupuestos',
  'apartados',
  'movimientos_apartado',
  'traspasos',
  'escenarios_simulacion',
  'conversaciones_chat',
  'cuotas_ia',
  'notificaciones',
];

/**
 * requerimientos-backend.md §2.11 y §4.
 *
 * - Borrar un usuario (derechos ARCO) borra todo lo suyo. Las FK de catálogo
 *   (categoría, tarjeta, cuenta, recurrente) se quedan en NO ACTION: impiden
 *   borrar un catálogo con historial, pero como se revisan al final de la
 *   sentencia no estorban al borrado en cascada del usuario.
 * - FK compuestas (usuario_id, x_id) para que la tarjeta, la cuenta, el
 *   apartado o la recurrente sean del mismo usuario, y (tarjeta_id, cuenta_id)
 *   para que la tarjeta pertenezca a la cuenta indicada.
 * - CHECK: tarjeta si y solo si el método es tarjeta; subtipo coherente con el
 *   flujo (decisión D3); color de apartados; periodo de cuotas_ia.
 * - Nombre de apartado único solo entre los activos; actualizado_en que
 *   faltaba; índices para Movimientos, Historial, Dashboard y saldos.
 * - Búsqueda sin acentos con pg_trgm y unaccent. unaccent no es IMMUTABLE,
 *   así que sin_acentos() la envuelve para poder usarla en un índice.
 */
export class AddIntegrityRules1795089609000 implements MigrationInterface {
  name = 'AddIntegrityRules1795089609000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES_OWNED_BY_USER) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          DROP CONSTRAINT fk_${table}_usuario_id,
          ADD CONSTRAINT fk_${table}_usuario_id
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
      `);
    }

    await queryRunner.query(`
      ALTER TABLE tarjetas
        ADD CONSTRAINT uq_tarjetas_usuario_id_id UNIQUE (usuario_id, id),
        ADD CONSTRAINT uq_tarjetas_id_cuenta_id UNIQUE (id, cuenta_id);
      ALTER TABLE apartados
        ADD CONSTRAINT uq_apartados_usuario_id_id UNIQUE (usuario_id, id);
      ALTER TABLE transacciones_recurrentes
        ADD CONSTRAINT uq_transacciones_recurrentes_usuario_id_id UNIQUE (usuario_id, id);
    `);

    await queryRunner.query(`
      ALTER TABLE transacciones
        DROP CONSTRAINT fk_transacciones_tarjeta_id,
        DROP CONSTRAINT fk_transacciones_recurrente_id,
        ADD CONSTRAINT fk_transacciones_tarjeta_id
          FOREIGN KEY (usuario_id, tarjeta_id) REFERENCES tarjetas (usuario_id, id),
        ADD CONSTRAINT fk_transacciones_tarjeta_id_cuenta_id
          FOREIGN KEY (tarjeta_id, cuenta_id) REFERENCES tarjetas (id, cuenta_id),
        ADD CONSTRAINT fk_transacciones_recurrente_id
          FOREIGN KEY (usuario_id, recurrente_id) REFERENCES transacciones_recurrentes (usuario_id, id);

      ALTER TABLE transacciones_recurrentes
        DROP CONSTRAINT fk_transacciones_recurrentes_tarjeta_id,
        ADD CONSTRAINT fk_transacciones_recurrentes_tarjeta_id
          FOREIGN KEY (usuario_id, tarjeta_id) REFERENCES tarjetas (usuario_id, id),
        ADD CONSTRAINT fk_transacciones_recurrentes_tarjeta_id_cuenta_id
          FOREIGN KEY (tarjeta_id, cuenta_id) REFERENCES tarjetas (id, cuenta_id);

      ALTER TABLE movimientos_apartado
        DROP CONSTRAINT fk_movimientos_apartado_apartado_id,
        ADD CONSTRAINT fk_movimientos_apartado_apartado_id
          FOREIGN KEY (usuario_id, apartado_id) REFERENCES apartados (usuario_id, id)
          ON DELETE CASCADE;

      ALTER TABLE mensajes_chat
        DROP CONSTRAINT fk_mensajes_chat_conversacion_id,
        ADD CONSTRAINT fk_mensajes_chat_conversacion_id
          FOREIGN KEY (conversacion_id) REFERENCES conversaciones_chat (id) ON DELETE CASCADE;

      ALTER TABLE simulacion_movimientos
        DROP CONSTRAINT fk_simulacion_movimientos_escenario_id,
        ADD CONSTRAINT fk_simulacion_movimientos_escenario_id
          FOREIGN KEY (escenario_id) REFERENCES escenarios_simulacion (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE transacciones
        DROP CONSTRAINT ck_transacciones_tarjeta_id,
        ADD CONSTRAINT ck_transacciones_tarjeta_id
          CHECK ((metodo_pago = 'tarjeta') = (tarjeta_id IS NOT NULL)),
        ADD CONSTRAINT ck_transacciones_subtipo CHECK (
          (tipo_flujo = 'ingreso' AND subtipo IN ('recurrente', 'variable'))
          OR (tipo_flujo = 'gasto' AND subtipo IN ('fijo', 'variable'))
        );

      ALTER TABLE transacciones_recurrentes
        ADD CONSTRAINT ck_transacciones_recurrentes_tarjeta_id
          CHECK ((metodo_pago = 'tarjeta') = (tarjeta_id IS NOT NULL)),
        ADD CONSTRAINT ck_transacciones_recurrentes_subtipo CHECK (
          (tipo_flujo = 'ingreso' AND subtipo = 'recurrente')
          OR (tipo_flujo = 'gasto' AND subtipo = 'fijo')
        );

      ALTER TABLE apartados
        ADD CONSTRAINT ck_apartados_color_hex CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
        DROP CONSTRAINT uq_apartados_usuario_id_nombre;
      CREATE UNIQUE INDEX uq_apartados_usuario_id_nombre
        ON apartados (usuario_id, lower(nombre)) WHERE activo;

      ALTER TABLE cuotas_ia
        ADD CONSTRAINT ck_cuotas_ia_periodo CHECK (periodo = date_trunc('month', periodo)::date);

      ALTER TABLE tarjetas ADD COLUMN actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE apartados ADD COLUMN actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE transacciones_recurrentes ADD COLUMN actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
    `);

    await queryRunner.query(`
      CREATE INDEX idx_transacciones_usuario_id_fecha
        ON transacciones (usuario_id, fecha DESC, creado_en DESC);
      CREATE INDEX idx_transacciones_usuario_id_categoria_id_fecha
        ON transacciones (usuario_id, categoria_id, fecha);
      CREATE INDEX idx_transacciones_cuenta_id_fecha ON transacciones (cuenta_id, fecha);
      CREATE INDEX idx_transacciones_tarjeta_id ON transacciones (tarjeta_id) WHERE tarjeta_id IS NOT NULL;
      CREATE INDEX idx_movimientos_apartado_usuario_id_fecha
        ON movimientos_apartado (usuario_id, fecha DESC, creado_en DESC);
      CREATE INDEX idx_movimientos_apartado_apartado_id_fecha
        ON movimientos_apartado (apartado_id, fecha DESC, creado_en DESC);
      CREATE INDEX idx_movimientos_apartado_cuenta_id_fecha ON movimientos_apartado (cuenta_id, fecha);
      CREATE INDEX idx_traspasos_usuario_id_fecha ON traspasos (usuario_id, fecha DESC, creado_en DESC);
      CREATE INDEX idx_traspasos_cuenta_origen_id_fecha ON traspasos (cuenta_origen_id, fecha);
      CREATE INDEX idx_traspasos_cuenta_destino_id_fecha ON traspasos (cuenta_destino_id, fecha);
      CREATE INDEX idx_tarjetas_cuenta_id ON tarjetas (cuenta_id);
      CREATE INDEX idx_conversaciones_chat_usuario_id_actualizado_en
        ON conversaciones_chat (usuario_id, actualizado_en DESC);
      CREATE INDEX idx_mensajes_chat_conversacion_id_id ON mensajes_chat (conversacion_id, id);
    `);

    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS unaccent;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE FUNCTION sin_acentos(texto text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        RETURN public.unaccent('public.unaccent'::regdictionary, texto);

      CREATE INDEX idx_transacciones_busqueda ON transacciones USING gin (
        sin_acentos(lower(concepto || ' ' || coalesce(alias_comercial, '') || ' ' || coalesce(notas, '')))
        gin_trgm_ops
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Las extensiones se quedan: pueden tener otros usos en la base.
    await queryRunner.query(`
      DROP INDEX idx_transacciones_busqueda;
      DROP FUNCTION sin_acentos(text);

      DROP INDEX idx_mensajes_chat_conversacion_id_id;
      DROP INDEX idx_conversaciones_chat_usuario_id_actualizado_en;
      DROP INDEX idx_tarjetas_cuenta_id;
      DROP INDEX idx_traspasos_cuenta_destino_id_fecha;
      DROP INDEX idx_traspasos_cuenta_origen_id_fecha;
      DROP INDEX idx_traspasos_usuario_id_fecha;
      DROP INDEX idx_movimientos_apartado_cuenta_id_fecha;
      DROP INDEX idx_movimientos_apartado_apartado_id_fecha;
      DROP INDEX idx_movimientos_apartado_usuario_id_fecha;
      DROP INDEX idx_transacciones_tarjeta_id;
      DROP INDEX idx_transacciones_cuenta_id_fecha;
      DROP INDEX idx_transacciones_usuario_id_categoria_id_fecha;
      DROP INDEX idx_transacciones_usuario_id_fecha;

      ALTER TABLE transacciones_recurrentes DROP COLUMN actualizado_en;
      ALTER TABLE apartados DROP COLUMN actualizado_en;
      ALTER TABLE tarjetas DROP COLUMN actualizado_en;

      ALTER TABLE cuotas_ia DROP CONSTRAINT ck_cuotas_ia_periodo;

      DROP INDEX uq_apartados_usuario_id_nombre;
      ALTER TABLE apartados
        ADD CONSTRAINT uq_apartados_usuario_id_nombre UNIQUE (usuario_id, nombre),
        DROP CONSTRAINT ck_apartados_color_hex;

      ALTER TABLE transacciones_recurrentes
        DROP CONSTRAINT ck_transacciones_recurrentes_subtipo,
        DROP CONSTRAINT ck_transacciones_recurrentes_tarjeta_id;
      ALTER TABLE transacciones
        DROP CONSTRAINT ck_transacciones_subtipo,
        DROP CONSTRAINT ck_transacciones_tarjeta_id,
        ADD CONSTRAINT ck_transacciones_tarjeta_id
          CHECK (metodo_pago <> 'tarjeta' OR tarjeta_id IS NOT NULL);

      ALTER TABLE simulacion_movimientos
        DROP CONSTRAINT fk_simulacion_movimientos_escenario_id,
        ADD CONSTRAINT fk_simulacion_movimientos_escenario_id
          FOREIGN KEY (escenario_id) REFERENCES escenarios_simulacion (id);
      ALTER TABLE mensajes_chat
        DROP CONSTRAINT fk_mensajes_chat_conversacion_id,
        ADD CONSTRAINT fk_mensajes_chat_conversacion_id
          FOREIGN KEY (conversacion_id) REFERENCES conversaciones_chat (id);
      ALTER TABLE movimientos_apartado
        DROP CONSTRAINT fk_movimientos_apartado_apartado_id,
        ADD CONSTRAINT fk_movimientos_apartado_apartado_id
          FOREIGN KEY (apartado_id) REFERENCES apartados (id);
      ALTER TABLE transacciones_recurrentes
        DROP CONSTRAINT fk_transacciones_recurrentes_tarjeta_id_cuenta_id,
        DROP CONSTRAINT fk_transacciones_recurrentes_tarjeta_id,
        ADD CONSTRAINT fk_transacciones_recurrentes_tarjeta_id
          FOREIGN KEY (tarjeta_id) REFERENCES tarjetas (id);
      ALTER TABLE transacciones
        DROP CONSTRAINT fk_transacciones_recurrente_id,
        DROP CONSTRAINT fk_transacciones_tarjeta_id_cuenta_id,
        DROP CONSTRAINT fk_transacciones_tarjeta_id,
        ADD CONSTRAINT fk_transacciones_tarjeta_id FOREIGN KEY (tarjeta_id) REFERENCES tarjetas (id),
        ADD CONSTRAINT fk_transacciones_recurrente_id
          FOREIGN KEY (recurrente_id) REFERENCES transacciones_recurrentes (id);

      ALTER TABLE transacciones_recurrentes DROP CONSTRAINT uq_transacciones_recurrentes_usuario_id_id;
      ALTER TABLE apartados DROP CONSTRAINT uq_apartados_usuario_id_id;
      ALTER TABLE tarjetas
        DROP CONSTRAINT uq_tarjetas_id_cuenta_id,
        DROP CONSTRAINT uq_tarjetas_usuario_id_id;
    `);

    for (const table of TABLES_OWNED_BY_USER) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          DROP CONSTRAINT fk_${table}_usuario_id,
          ADD CONSTRAINT fk_${table}_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
      `);
    }
  }
}
