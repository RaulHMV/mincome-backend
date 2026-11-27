import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * requerimientos-backend.md §2.1 y §2.2 (decisión D1: tablas completas).
 *
 * - cuentas: saldo por medio de pago (efectivo, débito y la cuenta de cada
 *   tarjeta de crédito). El saldo no se guarda: se calcula (§3.1).
 * - traspasos: dinero que pasa de una cuenta a otra, como el pago de tarjeta.
 *   No es ingreso ni gasto.
 * - usuarios.saldo_inicial pasa a una cuenta "Efectivo" por usuario.
 *
 * Diferencia con la propuesta: el nombre de la cuenta es único sin distinguir
 * mayúsculas y solo entre cuentas activas, igual que el alias de las tarjetas
 * (§2.3). La cuenta de una tarjeta de crédito se llama como su alias, y así se
 * puede dar de alta otra tarjeta con el alias de una desactivada.
 *
 * Los backfill solo importan si ya hay datos; dejan la migración correcta en
 * ese caso en lugar de fallar al poner NOT NULL.
 */
export class AddCuentasAndTraspasos1795089601000 implements MigrationInterface {
  name = 'AddCuentasAndTraspasos1795089601000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE tipo_cuenta AS ENUM ('efectivo', 'debito', 'credito');

      CREATE TABLE cuentas (
        id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id          UUID          NOT NULL,
        nombre              VARCHAR(50)   NOT NULL,
        tipo                tipo_cuenta   NOT NULL,
        saldo_inicial       NUMERIC(14,2) NOT NULL DEFAULT 0,
        fecha_saldo_inicial DATE          NOT NULL DEFAULT CURRENT_DATE,
        activa              BOOLEAN       NOT NULL DEFAULT true,
        creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
        actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_cuentas PRIMARY KEY (id),
        CONSTRAINT fk_cuentas_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        -- Destino de las FK compuestas que garantizan que la cuenta es del mismo usuario (§4).
        CONSTRAINT uq_cuentas_usuario_id_id UNIQUE (usuario_id, id),
        -- En crédito, negativo = deuda inicial.
        CONSTRAINT ck_cuentas_saldo_inicial CHECK (
          (tipo = 'credito' AND saldo_inicial <= 0) OR (tipo <> 'credito' AND saldo_inicial >= 0)
        )
      );
      CREATE UNIQUE INDEX uq_cuentas_usuario_id_nombre
        ON cuentas (usuario_id, lower(nombre)) WHERE activa;
    `);

    await queryRunner.query(`
      INSERT INTO cuentas (usuario_id, nombre, tipo, saldo_inicial, fecha_saldo_inicial)
      SELECT id, 'Efectivo', 'efectivo', saldo_inicial, creado_en::date FROM usuarios;

      ALTER TABLE usuarios DROP COLUMN saldo_inicial;
    `);

    // Una tarjeta pertenece a una cuenta: la de débito a su cuenta de nómina,
    // la de crédito a su propia cuenta.
    await queryRunner.query(`
      ALTER TABLE tarjetas ADD COLUMN cuenta_id UUID;

      WITH nuevas AS (
        INSERT INTO cuentas (usuario_id, nombre, tipo, fecha_saldo_inicial)
        SELECT usuario_id, alias,
               CASE tipo_tarjeta WHEN 'credito' THEN 'credito'::tipo_cuenta ELSE 'debito'::tipo_cuenta END,
               creado_en::date
        FROM tarjetas
        RETURNING id, usuario_id, nombre
      )
      UPDATE tarjetas t SET cuenta_id = n.id
      FROM nuevas n
      WHERE n.usuario_id = t.usuario_id AND n.nombre = t.alias;

      ALTER TABLE tarjetas
        ALTER COLUMN cuenta_id SET NOT NULL,
        ADD CONSTRAINT fk_tarjetas_cuenta_id
          FOREIGN KEY (usuario_id, cuenta_id) REFERENCES cuentas (usuario_id, id);
    `);

    // Sin tarjeta no se sabe de qué cuenta salió el dinero; los movimientos que
    // ya existan quedan en la cuenta "Efectivo" del usuario.
    for (const table of [
      'transacciones',
      'transacciones_recurrentes',
      'movimientos_apartado',
    ]) {
      await queryRunner.query(`
        ALTER TABLE ${table} ADD COLUMN cuenta_id UUID;

        UPDATE ${table} x SET cuenta_id = COALESCE(
          ${table === 'movimientos_apartado' ? 'NULL' : '(SELECT t.cuenta_id FROM tarjetas t WHERE t.id = x.tarjeta_id)'},
          (SELECT c.id FROM cuentas c
           WHERE c.usuario_id = x.usuario_id AND c.tipo = 'efectivo'
           ORDER BY c.creado_en LIMIT 1)
        );

        ALTER TABLE ${table}
          ALTER COLUMN cuenta_id SET NOT NULL,
          ADD CONSTRAINT fk_${table}_cuenta_id
            FOREIGN KEY (usuario_id, cuenta_id) REFERENCES cuentas (usuario_id, id);
      `);
    }

    await queryRunner.query(`
      CREATE TABLE traspasos (
        id                UUID          NOT NULL DEFAULT gen_random_uuid(),
        usuario_id        UUID          NOT NULL,
        cuenta_origen_id  UUID          NOT NULL,
        cuenta_destino_id UUID          NOT NULL,
        monto             NUMERIC(12,2) NOT NULL,
        fecha             DATE          NOT NULL,
        nota              VARCHAR(200),
        creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT pk_traspasos PRIMARY KEY (id),
        CONSTRAINT fk_traspasos_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
        CONSTRAINT fk_traspasos_cuenta_origen_id
          FOREIGN KEY (usuario_id, cuenta_origen_id) REFERENCES cuentas (usuario_id, id),
        CONSTRAINT fk_traspasos_cuenta_destino_id
          FOREIGN KEY (usuario_id, cuenta_destino_id) REFERENCES cuentas (usuario_id, id),
        CONSTRAINT ck_traspasos_monto CHECK (monto > 0),
        CONSTRAINT ck_traspasos_cuentas_distintas CHECK (cuenta_origen_id <> cuenta_destino_id)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE traspasos;
      ALTER TABLE movimientos_apartado DROP COLUMN cuenta_id;
      ALTER TABLE transacciones_recurrentes DROP COLUMN cuenta_id;
      ALTER TABLE transacciones DROP COLUMN cuenta_id;
      ALTER TABLE tarjetas DROP COLUMN cuenta_id;
      ALTER TABLE usuarios ADD COLUMN saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0;
      UPDATE usuarios u SET saldo_inicial = c.saldo_inicial
      FROM cuentas c
      WHERE c.usuario_id = u.id AND c.tipo = 'efectivo' AND c.nombre = 'Efectivo';
      DROP TABLE cuentas;
      DROP TYPE tipo_cuenta;
    `);
  }
}
