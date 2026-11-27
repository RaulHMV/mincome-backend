import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema base: los tipos enumerados y las 14 tablas del diccionario de datos
 * del README de mincome-start, tal como están ahí. Los cambios propuestos en
 * requerimientos-backend.md van en las migraciones siguientes, una por sección.
 */
export class CreateBaseSchema1795089600000 implements MigrationInterface {
  name = 'CreateBaseSchema1795089600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE tipo_flujo AS ENUM ('ingreso', 'gasto');
      CREATE TYPE subtipo_flujo AS ENUM ('recurrente', 'variable', 'fijo');
      CREATE TYPE metodo_pago AS ENUM ('efectivo', 'transferencia', 'tarjeta');
      CREATE TYPE tipo_tarjeta AS ENUM ('credito', 'debito');
      CREATE TYPE frecuencia AS ENUM ('semanal', 'quincenal', 'mensual', 'anual');
      CREATE TYPE tipo_mov_apartado AS ENUM ('abono', 'retiro');
      CREATE TYPE tipo_simulacion AS ENUM ('ingreso', 'gasto', 'ahorro');
      CREATE TYPE rol_mensaje AS ENUM ('usuario', 'asistente', 'sistema');
      CREATE TYPE nivel_alerta AS ENUM ('ninguna', 'preventiva', 'excedida');
    `);

    await queryRunner.query(`
      CREATE TABLE planes (
        id                   SMALLINT GENERATED ALWAYS AS IDENTITY,
        nombre               VARCHAR(30)  NOT NULL,
        limite_consultas_mes INT          NOT NULL,
        limite_tokens_mes    INT          NOT NULL,
        precio_mensual       NUMERIC(8,2) NOT NULL DEFAULT 0,
        incluye_asistente    BOOLEAN      NOT NULL DEFAULT false,
        activo               BOOLEAN      NOT NULL DEFAULT true,
        CONSTRAINT pk_planes PRIMARY KEY (id),
        CONSTRAINT uq_planes_nombre UNIQUE (nombre),
        CONSTRAINT ck_planes_limite_consultas_mes CHECK (limite_consultas_mes >= 0),
        CONSTRAINT ck_planes_limite_tokens_mes CHECK (limite_tokens_mes >= 0),
        CONSTRAINT ck_planes_precio_mensual CHECK (precio_mensual >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE usuarios (
        id             UUID          NOT NULL DEFAULT gen_random_uuid(),
        plan_id        SMALLINT      NOT NULL,
        nombre         VARCHAR(100)  NOT NULL,
        correo         VARCHAR(254)  NOT NULL,
        cognito_sub    VARCHAR(64)   NOT NULL,
        saldo_inicial  NUMERIC(14,2) NOT NULL DEFAULT 0,
        moneda         CHAR(3)       NOT NULL DEFAULT 'MXN',
        activo         BOOLEAN       NOT NULL DEFAULT true,
        ultimo_acceso  TIMESTAMPTZ,
        creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_usuarios PRIMARY KEY (id),
        CONSTRAINT fk_usuarios_plan_id FOREIGN KEY (plan_id) REFERENCES planes (id),
        CONSTRAINT uq_usuarios_cognito_sub UNIQUE (cognito_sub),
        CONSTRAINT ck_usuarios_correo
          CHECK (correo ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
      );
      CREATE UNIQUE INDEX uq_usuarios_correo ON usuarios (lower(correo));
    `);

    await queryRunner.query(`
      CREATE TABLE categorias (
        id             INT GENERATED ALWAYS AS IDENTITY,
        usuario_id     UUID,
        nombre         VARCHAR(50) NOT NULL,
        icono          VARCHAR(40),
        tipo_aplicable VARCHAR(10) NOT NULL,
        es_sistema     BOOLEAN     NOT NULL DEFAULT false,
        CONSTRAINT pk_categorias PRIMARY KEY (id),
        CONSTRAINT fk_categorias_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT ck_categorias_tipo_aplicable
          CHECK (tipo_aplicable IN ('ingreso', 'gasto', 'ambos'))
      );
      CREATE UNIQUE INDEX uq_categorias_usuario_id_nombre ON categorias (
        COALESCE(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(nombre)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE tarjetas (
        id              UUID         NOT NULL DEFAULT gen_random_uuid(),
        usuario_id      UUID         NOT NULL,
        alias           VARCHAR(50)  NOT NULL,
        tipo_tarjeta    tipo_tarjeta NOT NULL,
        dia_corte       SMALLINT     NOT NULL,
        dia_limite_pago SMALLINT     NOT NULL,
        color_hex       CHAR(7),
        activa          BOOLEAN      NOT NULL DEFAULT true,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pk_tarjetas PRIMARY KEY (id),
        CONSTRAINT fk_tarjetas_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT uq_tarjetas_usuario_id_alias UNIQUE (usuario_id, alias),
        CONSTRAINT ck_tarjetas_dia_corte CHECK (dia_corte BETWEEN 1 AND 31),
        CONSTRAINT ck_tarjetas_dia_limite_pago CHECK (dia_limite_pago BETWEEN 1 AND 31),
        CONSTRAINT ck_tarjetas_color_hex CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE transacciones_recurrentes (
        id            UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id    UUID          NOT NULL,
        categoria_id  INT           NOT NULL,
        tipo_flujo    tipo_flujo    NOT NULL,
        subtipo       subtipo_flujo NOT NULL,
        monto         NUMERIC(12,2) NOT NULL,
        concepto      VARCHAR(120)  NOT NULL,
        metodo_pago   metodo_pago   NOT NULL,
        tarjeta_id    UUID,
        frecuencia    frecuencia    NOT NULL,
        dia_ejecucion SMALLINT,
        fecha_inicio  DATE          NOT NULL,
        fecha_fin     DATE,
        activa        BOOLEAN       NOT NULL DEFAULT true,
        creado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_transacciones_recurrentes PRIMARY KEY (id),
        CONSTRAINT fk_transacciones_recurrentes_usuario_id
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT fk_transacciones_recurrentes_categoria_id
          FOREIGN KEY (categoria_id) REFERENCES categorias (id),
        CONSTRAINT fk_transacciones_recurrentes_tarjeta_id
          FOREIGN KEY (tarjeta_id) REFERENCES tarjetas (id),
        CONSTRAINT ck_transacciones_recurrentes_monto CHECK (monto > 0),
        CONSTRAINT ck_transacciones_recurrentes_dia_ejecucion
          CHECK (dia_ejecucion BETWEEN 1 AND 31),
        CONSTRAINT ck_transacciones_recurrentes_fecha_fin CHECK (fecha_fin >= fecha_inicio)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE transacciones (
        id              UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id      UUID          NOT NULL,
        categoria_id    INT           NOT NULL,
        tipo_flujo      tipo_flujo    NOT NULL,
        subtipo         subtipo_flujo NOT NULL,
        monto           NUMERIC(12,2) NOT NULL,
        fecha           DATE          NOT NULL,
        concepto        VARCHAR(120)  NOT NULL,
        alias_comercial VARCHAR(80),
        notas           TEXT,
        metodo_pago     metodo_pago   NOT NULL,
        tarjeta_id      UUID,
        recurrente_id   UUID,
        nivel_alerta    nivel_alerta  NOT NULL DEFAULT 'ninguna',
        creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
        actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_transacciones PRIMARY KEY (id),
        CONSTRAINT fk_transacciones_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT fk_transacciones_categoria_id FOREIGN KEY (categoria_id) REFERENCES categorias (id),
        CONSTRAINT fk_transacciones_tarjeta_id FOREIGN KEY (tarjeta_id) REFERENCES tarjetas (id),
        CONSTRAINT fk_transacciones_recurrente_id
          FOREIGN KEY (recurrente_id) REFERENCES transacciones_recurrentes (id),
        CONSTRAINT ck_transacciones_monto CHECK (monto > 0),
        CONSTRAINT ck_transacciones_tarjeta_id CHECK (metodo_pago <> 'tarjeta' OR tarjeta_id IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE presupuestos (
        id             UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id     UUID          NOT NULL,
        categoria_id   INT           NOT NULL,
        monto_limite   NUMERIC(12,2) NOT NULL,
        umbral_alerta  SMALLINT      NOT NULL DEFAULT 80,
        activo         BOOLEAN       NOT NULL DEFAULT true,
        creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_presupuestos PRIMARY KEY (id),
        CONSTRAINT fk_presupuestos_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT fk_presupuestos_categoria_id FOREIGN KEY (categoria_id) REFERENCES categorias (id),
        CONSTRAINT uq_presupuestos_usuario_id_categoria_id UNIQUE (usuario_id, categoria_id),
        CONSTRAINT ck_presupuestos_monto_limite CHECK (monto_limite > 0),
        CONSTRAINT ck_presupuestos_umbral_alerta CHECK (umbral_alerta BETWEEN 1 AND 99)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE apartados (
        id         UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id UUID          NOT NULL,
        nombre     VARCHAR(60)   NOT NULL,
        saldo      NUMERIC(14,2) NOT NULL DEFAULT 0,
        meta_monto NUMERIC(14,2),
        fecha_meta DATE,
        color_hex  CHAR(7),
        icono      VARCHAR(40),
        activo     BOOLEAN       NOT NULL DEFAULT true,
        creado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_apartados PRIMARY KEY (id),
        CONSTRAINT fk_apartados_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT uq_apartados_usuario_id_nombre UNIQUE (usuario_id, nombre),
        CONSTRAINT ck_apartados_saldo CHECK (saldo >= 0),
        CONSTRAINT ck_apartados_meta_monto CHECK (meta_monto > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE movimientos_apartado (
        id          UUID              NOT NULL DEFAULT gen_random_uuid(),
        apartado_id UUID              NOT NULL,
        usuario_id  UUID              NOT NULL,
        tipo        tipo_mov_apartado NOT NULL,
        monto       NUMERIC(12,2)     NOT NULL,
        fecha       DATE              NOT NULL DEFAULT CURRENT_DATE,
        nota        VARCHAR(200),
        creado_en   TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT pk_movimientos_apartado PRIMARY KEY (id),
        CONSTRAINT fk_movimientos_apartado_apartado_id
          FOREIGN KEY (apartado_id) REFERENCES apartados (id),
        CONSTRAINT fk_movimientos_apartado_usuario_id
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT ck_movimientos_apartado_monto CHECK (monto > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE escenarios_simulacion (
        id               UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id       UUID          NOT NULL,
        nombre           VARCHAR(80)   NOT NULL,
        fecha_inicio     DATE          NOT NULL,
        fecha_fin        DATE          NOT NULL,
        saldo_base       NUMERIC(14,2) NOT NULL,
        saldo_proyectado NUMERIC(14,2),
        creado_en        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_escenarios_simulacion PRIMARY KEY (id),
        CONSTRAINT fk_escenarios_simulacion_usuario_id
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT ck_escenarios_simulacion_fecha_fin CHECK (fecha_fin >= fecha_inicio)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE simulacion_movimientos (
        id           BIGINT GENERATED ALWAYS AS IDENTITY,
        escenario_id UUID            NOT NULL,
        fecha        DATE            NOT NULL,
        tipo         tipo_simulacion NOT NULL,
        monto        NUMERIC(12,2)   NOT NULL,
        descripcion  VARCHAR(120),
        CONSTRAINT pk_simulacion_movimientos PRIMARY KEY (id),
        CONSTRAINT fk_simulacion_movimientos_escenario_id
          FOREIGN KEY (escenario_id) REFERENCES escenarios_simulacion (id),
        CONSTRAINT ck_simulacion_movimientos_monto CHECK (monto > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE conversaciones_chat (
        id             UUID         NOT NULL DEFAULT gen_random_uuid(),
        usuario_id     UUID         NOT NULL,
        titulo         VARCHAR(100),
        creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pk_conversaciones_chat PRIMARY KEY (id),
        CONSTRAINT fk_conversaciones_chat_usuario_id
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE mensajes_chat (
        id               BIGINT GENERATED ALWAYS AS IDENTITY,
        conversacion_id  UUID        NOT NULL,
        rol              rol_mensaje NOT NULL,
        contenido        TEXT        NOT NULL,
        estrategia_usada VARCHAR(40),
        tokens_entrada   INT         NOT NULL DEFAULT 0,
        tokens_salida    INT         NOT NULL DEFAULT 0,
        creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_mensajes_chat PRIMARY KEY (id),
        CONSTRAINT fk_mensajes_chat_conversacion_id
          FOREIGN KEY (conversacion_id) REFERENCES conversaciones_chat (id),
        CONSTRAINT ck_mensajes_chat_tokens_entrada CHECK (tokens_entrada >= 0),
        CONSTRAINT ck_mensajes_chat_tokens_salida CHECK (tokens_salida >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE cuotas_ia (
        id               UUID        NOT NULL DEFAULT gen_random_uuid(),
        usuario_id       UUID        NOT NULL,
        periodo          DATE        NOT NULL,
        consultas_usadas INT         NOT NULL DEFAULT 0,
        tokens_usados    INT         NOT NULL DEFAULT 0,
        actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_cuotas_ia PRIMARY KEY (id),
        CONSTRAINT fk_cuotas_ia_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT uq_cuotas_ia_usuario_id_periodo UNIQUE (usuario_id, periodo),
        CONSTRAINT ck_cuotas_ia_consultas_usadas CHECK (consultas_usadas >= 0),
        CONSTRAINT ck_cuotas_ia_tokens_usados CHECK (tokens_usados >= 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE cuotas_ia;
      DROP TABLE mensajes_chat;
      DROP TABLE conversaciones_chat;
      DROP TABLE simulacion_movimientos;
      DROP TABLE escenarios_simulacion;
      DROP TABLE movimientos_apartado;
      DROP TABLE apartados;
      DROP TABLE presupuestos;
      DROP TABLE transacciones;
      DROP TABLE transacciones_recurrentes;
      DROP TABLE tarjetas;
      DROP TABLE categorias;
      DROP TABLE usuarios;
      DROP TABLE planes;
      DROP TYPE nivel_alerta;
      DROP TYPE rol_mensaje;
      DROP TYPE tipo_simulacion;
      DROP TYPE tipo_mov_apartado;
      DROP TYPE frecuencia;
      DROP TYPE tipo_tarjeta;
      DROP TYPE metodo_pago;
      DROP TYPE subtipo_flujo;
      DROP TYPE tipo_flujo;
    `);
  }
}
