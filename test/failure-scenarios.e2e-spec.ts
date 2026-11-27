import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDays, todayIn } from '../src/common/dates';
import { RecurringTransactionsService } from '../src/recurring-transactions/recurring-transactions.service';
import {
  CATEGORY,
  currentMonth,
  expense,
  postTransaction,
  setUpUser,
  today,
} from './support/fixtures';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';
import { idTokenFor, signToken, TEST_ISSUER } from './support/tokens';

// Lo que pasa en producción y no en el camino feliz: dobles taps, dos
// dispositivos a la vez, el front pidiendo todo al mismo tiempo en el primer
// login, un failover de RDS Proxy, una falla a media transacción, tokens
// falsificados y entradas hostiles. Cada prueba afirma el comportamiento
// correcto; si una falla, es un bug.

describe('Escenarios de falla (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
  });

  afterAll(() => testApp.close());

  const statusesOf = (responses: request.Response[]) =>
    responses.map((response) => response.status).sort((a, b) => a - b);

  describe('Carreras', () => {
    it('dos gastos simultáneos que juntos pasan el saldo: solo entra uno (D14)', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-saldo', {
        debitBalance: 100,
      });
      const responses = await Promise.all(
        [1, 2].map(() => postTransaction(ana.client, expense(ana.debitId, 60))),
      );
      expect(statusesOf(responses)).toEqual([201, 409]);
      expect(responses.find((r) => r.status === 409)?.body.error.code).toBe(
        'insufficient_funds',
      );
      const accounts = await ana.client.get('/accounts').expect(200);
      expect(
        accounts.body.find((a: { id: string }) => a.id === ana.debitId).balance,
      ).toBe(40);
    });

    it('diez retiros simultáneos de un apartado que solo alcanza para tres', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-apartado', {
        debitBalance: 1000,
      });
      const pocket = await ana.client
        .post('/pockets')
        .send({
          name: 'Viaje',
          targetAmount: 1000,
          initialAmount: 300,
          sourceAccountId: ana.debitId,
        })
        .expect(201);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          ana.client
            .post(`/pockets/${pocket.body.id}/movements`)
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'withdrawal', amount: 100, accountId: ana.debitId }),
        ),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(7);
      const pockets = await ana.client.get('/pockets').expect(200);
      expect(pockets.body[0].balance).toBe(0);
    });

    it('dos pagos simultáneos por toda la deuda de la tarjeta: solo pasa uno', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-pago', {
        debitBalance: 5000,
      });
      const card = await ana.client
        .post('/cards')
        .send({
          alias: 'Oro',
          bank: 'BBVA',
          last4: '1111',
          type: 'credit',
          creditLimit: 5000,
          cutoffDay: 10,
          dueDay: 30,
          initialDebt: 500,
        })
        .expect(201);
      const responses = await Promise.all(
        [1, 2].map(() =>
          ana.client
            .post(`/cards/${card.body.id}/payments`)
            .set('Idempotency-Key', randomUUID())
            .send({ amount: 500, sourceAccountId: ana.debitId }),
        ),
      );
      expect(statusesOf(responses)).toEqual([201, 409]);
    });

    it('doble tap con la misma Idempotency-Key, al mismo tiempo: un solo gasto', async () => {
      const ana = await setUpUser(testApp, 'sub-doble-tap', {
        debitBalance: 1000,
      });
      const key = randomUUID();
      const body = expense(ana.debitId, 25, { concept: 'Doble tap' });
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          ana.client
            .post('/transactions')
            .set('Idempotency-Key', key)
            .send(body),
        ),
      );
      // Cada reintento recibe la respuesta guardada o "todavía en curso".
      for (const response of responses) {
        expect([201, 409]).toContain(response.status);
        if (response.status === 409) {
          expect(response.body.error.code).toBe('idempotency_key_in_use');
        }
      }
      const created = responses.filter((r) => r.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(new Set(created.map((r) => r.body.transaction.id)).size).toBe(1);
      const [{ total }] = await testApp.dataSource.query(
        `SELECT count(*)::int AS total FROM transacciones WHERE concepto = 'Doble tap'`,
      );
      expect(total).toBe(1);
    });

    it('la misma llave con otro cuerpo no reutiliza la respuesta', async () => {
      const ana = await setUpUser(testApp, 'sub-llave-reusada', {
        debitBalance: 1000,
      });
      const key = randomUUID();
      await ana.client
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(expense(ana.debitId, 10))
        .expect(201);
      const reused = await ana.client
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(expense(ana.debitId, 999))
        .expect(422);
      expect(reused.body.error.code).toBe('idempotency_key_reused');
    });

    it('dos gastos simultáneos que juntos cruzan el 80 %: solo uno guarda la alerta (§3.3)', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-presupuesto', {
        debitBalance: 1000,
      });
      await ana.client
        .put(`/budgets?month=${currentMonth()}`)
        .send([{ categoryId: CATEGORY.FOOD, limit: 100 }])
        .expect(200);
      const responses = await Promise.all(
        [1, 2].map(() =>
          postTransaction(
            ana.client,
            expense(ana.debitId, 45, { categoryId: CATEGORY.FOOD }),
          ).expect(201),
        ),
      );
      expect(
        responses
          .map((r): string => r.body.transaction.alertLevel)
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(['none', 'warning']);
    });

    it('doce apartados a la vez con tope de 10: entran exactamente 10', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-tope', {
        debitBalance: 0,
      });
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          ana.client
            .post('/pockets')
            .send({ name: `Meta ${index}`, targetAmount: 100 }),
        ),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
      const active = await ana.client.get('/pockets?isActive=true').expect(200);
      expect(active.body).toHaveLength(10);
    });

    it('el mismo alias, la misma cuenta o la misma categoría desde dos dispositivos: una sola gana', async () => {
      const ana = await setUpUser(testApp, 'sub-carrera-nombres', {
        debitBalance: 0,
      });
      const twice = (send: () => request.Test) => Promise.all([send(), send()]);

      const cards = await twice(() =>
        ana.client.post('/cards').send({
          alias: 'Mi tarjeta',
          bank: 'Banorte',
          last4: '2222',
          type: 'credit',
          creditLimit: 100,
          cutoffDay: 1,
          dueDay: 20,
        }),
      );
      const accounts = await twice(() =>
        ana.client
          .post('/accounts')
          .send({ name: 'Ahorro', type: 'debit', initialBalance: 0 }),
      );
      const categories = await Promise.all([
        ana.client
          .post('/categories')
          .send({ name: 'Mascotas', icon: 'paw-print', appliesTo: 'expense' }),
        ana.client
          .post('/categories')
          .send({ name: 'MASCOTAS', icon: 'paw-print', appliesTo: 'expense' }),
      ]);
      for (const pair of [cards, accounts, categories]) {
        expect(statusesOf(pair)).toEqual([201, 409]);
        expect(pair.find((r) => r.status === 409)?.body.error.code).toBe(
          'conflict',
        );
      }
    });

    it('el front pide todo a la vez en el primer login: un solo usuario y una sola cuenta Efectivo', async () => {
      const nuevo = testApp.as({
        sub: 'sub-primer-login',
        name: 'Nuevo',
        email: 'nuevo@correo.com',
      });
      const responses = await Promise.all(
        [
          '/me',
          '/accounts',
          '/cards',
          '/pockets',
          '/categories',
          `/budgets?month=${currentMonth()}`,
        ].map((path) => nuevo.get(path)),
      );
      expect(statusesOf(responses)).toEqual([200, 200, 200, 200, 200, 200]);
      const [{ users, cash }] = await testApp.dataSource.query(
        `SELECT count(DISTINCT u.id)::int AS users, count(c.id)::int AS cash
         FROM usuarios u LEFT JOIN cuentas c ON c.usuario_id = u.id AND c.tipo = 'efectivo'
         WHERE u.cognito_sub = 'sub-primer-login'`,
      );
      expect({ users, cash }).toEqual({ users: 1, cash: 1 });
    });

    it('el proceso diario corriendo dos veces a la vez no duplica recurrentes', async () => {
      const ana = await setUpUser(testApp, 'sub-diario-doble', {
        debitBalance: 1000,
        initialBalanceDate: addDays(today(), -60),
      });
      const created = await ana.client
        .post('/recurring-transactions')
        .send({
          type: 'expense',
          subtype: 'fixed',
          categoryId: CATEGORY.SERVICES,
          amount: 10,
          concept: 'Streaming',
          paymentMethod: 'transfer',
          accountId: ana.debitId,
          frequency: 'weekly',
          startDate: addDays(today(), -49),
          endDate: null,
        })
        .expect(201);
      const expected = created.body.generatedTransactions.length;
      expect(expected).toBe(8);
      // Como si el proceso no hubiera corrido desde el inicio.
      await testApp.dataSource.query(
        `DELETE FROM transacciones WHERE recurrente_id = $1`,
        [created.body.recurringTransaction.id],
      );
      await testApp.dataSource.query(
        `UPDATE transacciones_recurrentes SET proxima_ejecucion = fecha_inicio WHERE id = $1`,
        [created.body.recurringTransaction.id],
      );
      const service = testApp.app.get(RecurringTransactionsService);
      await Promise.all([service.generateAllDue(), service.generateAllDue()]);
      const [{ total }] = await testApp.dataSource.query(
        `SELECT count(*)::int AS total FROM transacciones WHERE recurrente_id = $1`,
        [created.body.recurringTransaction.id],
      );
      expect(total).toBe(expected);
    });
  });

  describe('Fallas de la base', () => {
    it('una falla a media transacción no deja nada a medias, no filtra detalles y deja reintentar con la misma llave', async () => {
      const ana = await setUpUser(testApp, 'sub-falla-media', {
        debitBalance: 1000,
      });
      const pocket = await ana.client
        .post('/pockets')
        .send({ name: 'Colchón', targetAmount: 500 })
        .expect(201);
      // Truena el INSERT del movimiento, después de que ya se sumó el saldo.
      await testApp.dataSource.query(`
        CREATE FUNCTION falla_forzada() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.nota = 'forzar-falla' THEN
            RAISE EXCEPTION 'falla forzada en movimientos_apartado (secreto interno)';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER falla_forzada BEFORE INSERT ON movimientos_apartado
          FOR EACH ROW EXECUTE FUNCTION falla_forzada();
      `);
      const key = randomUUID();
      const deposit = () =>
        ana.client
          .post(`/pockets/${pocket.body.id}/movements`)
          .set('Idempotency-Key', key)
          .send({
            type: 'deposit',
            amount: 200,
            accountId: ana.debitId,
            note: 'forzar-falla',
          });
      try {
        const failed = await deposit().expect(500);
        expect(failed.body).toEqual({
          error: {
            code: 'internal_error',
            message: expect.any(String),
            fields: null,
          },
        });
        expect(JSON.stringify(failed.body)).not.toMatch(
          /secreto|movimientos_apartado|trigger|at /i,
        );
        const pockets = await ana.client.get('/pockets').expect(200);
        expect(pockets.body[0].balance).toBe(0);
      } finally {
        await testApp.dataSource.query(`
          DROP TRIGGER falla_forzada ON movimientos_apartado;
          DROP FUNCTION falla_forzada();
        `);
      }
      // El 500 no se guardó como respuesta de la llave: el reintento sí entra.
      const retry = await deposit().expect(201);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.body.pocket.balance).toBe(200);
    });

    it('se recupera cuando la base corta todas las conexiones (failover de RDS Proxy)', async () => {
      const ana = await setUpUser(testApp, 'sub-failover', {
        debitBalance: 100,
      });
      await Promise.all(
        [1, 2, 3].map(() => ana.client.get('/accounts').expect(200)),
      );
      await testApp.dataSource.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
      // El pool descarta las conexiones muertas cuando llega el aviso.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => ana.client.get('/accounts')),
      );
      expect(statusesOf(responses)).toEqual([200, 200, 200, 200, 200, 200]);
    });
  });

  describe('Tokens falsificados', () => {
    const me = (token: string) =>
      testApp
        .anonymous()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${token}`);
    const claims = {
      sub: 'sub-victima',
      token_use: 'id',
      aud: process.env.COGNITO_CLIENT_IDS,
      email: 'victima@correo.com',
      name: 'Víctima',
    };

    it('rechaza alg none, payload alterado y la firma de otra llave con el mismo kid', async () => {
      const valid = signToken(claims);
      const [header, payload] = valid.split('.');
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');

      const algNone = `${encode({ alg: 'none', kid: 'test-key', typ: 'JWT' })}.${payload}.`;
      const tampered = `${header}.${encode({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'sub-otro', 'cognito:groups': ['premium'] })}.${valid.split('.')[2]}`;
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const data = `${encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${encode({ ...claims, iss: TEST_ISSUER, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
      const otherKey = `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`;

      for (const token of [algNone, tampered, otherKey, 'no.es.jwt', '']) {
        const response = await me(token).expect(401);
        expect(response.body.error.code).toBe('unauthenticated');
      }
      const [{ total }] = await testApp.dataSource.query(
        `SELECT count(*)::int AS total FROM usuarios WHERE cognito_sub IN ('sub-victima', 'sub-otro')`,
      );
      expect(total).toBe(0);
    });

    it('un usuario desactivado ya no entra aunque su token siga vigente', async () => {
      const token = idTokenFor({ sub: 'sub-desactivado' });
      await me(token).expect(200);
      await testApp.dataSource.query(
        `UPDATE usuarios SET activo = false WHERE cognito_sub = 'sub-desactivado'`,
      );
      const response = await me(token).expect(401);
      expect(response.body.error.code).toBe('unauthenticated');
    });
  });

  describe('Entradas hostiles', () => {
    it('JSON mal formado o un cuerpo enorme responden con la forma de error, no con 500', async () => {
      const ana = await setUpUser(testApp, 'sub-json-roto', {
        debitBalance: 100,
      });
      const token = idTokenFor({ sub: 'sub-json-roto', name: 'sub-json-roto' });
      const broken = await testApp
        .anonymous()
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send('{"name": "Ahorro",, }');
      expect(broken.status).toBe(422);
      expect(broken.body.error.code).toBe('validation_error');

      const huge = await ana.client
        .post('/categories')
        .send({ name: 'x', icon: 'y'.repeat(2_000_000), appliesTo: 'expense' });
      expect(huge.status).toBe(413);
      expect(huge.body.error).toMatchObject({ code: 'validation_error' });
    });

    it('SQL en la búsqueda y en los ids se toma como texto', async () => {
      const ana = await setUpUser(testApp, 'sub-inyeccion', {
        debitBalance: 100,
      });
      await postTransaction(
        ana.client,
        expense(ana.debitId, 5, { concept: 'Café' }),
      ).expect(201);
      for (const q of [
        "' OR 1=1 --",
        "'; DROP TABLE transacciones; --",
        "Café' UNION SELECT * FROM usuarios --",
      ]) {
        const page = await ana.client
          .get(`/movements?q=${encodeURIComponent(q)}`)
          .expect(200);
        expect(page.body.total).toBe(0);
      }
      await ana.client
        .get(`/transactions/${encodeURIComponent("1' OR '1'='1")}`)
        .expect(404);
      const [{ total }] = await testApp.dataSource.query(
        `SELECT count(*)::int AS total FROM transacciones`,
      );
      expect(total).toBeGreaterThan(0);
    });

    it('montos como texto, fechas imposibles y 0.1 + 0.2', async () => {
      const ana = await setUpUser(testApp, 'sub-montos', { debitBalance: 100 });
      const asText = await postTransaction(ana.client, {
        ...expense(ana.debitId, 1),
        amount: '10',
      }).expect(422);
      expect(asText.body.error.fields).toHaveProperty('amount');
      const impossible = await postTransaction(
        ana.client,
        expense(ana.debitId, 1, { date: '2026-02-30' }),
      ).expect(422);
      expect(impossible.body.error.fields).toHaveProperty('date');
      // 0.30000000000000004 se guarda como 0.30, sin arrastrar el error.
      const floaty = await postTransaction(
        ana.client,
        expense(ana.debitId, 0.1 + 0.2),
      ).expect(201);
      expect(floaty.body.transaction.amount).toBe(0.3);
      const accounts = await ana.client.get('/accounts').expect(200);
      expect(
        accounts.body.find((a: { id: string }) => a.id === ana.debitId).balance,
      ).toBe(99.7);
    });

    it('nunca guarda CVV, NIP ni el número completo de la tarjeta (RNF3)', async () => {
      const ana = await setUpUser(testApp, 'sub-rnf3', { debitBalance: 0 });
      // Un cuerpo válido: cada caso falla solo por lo que agrega.
      const base = {
        alias: 'Oro',
        bank: 'BBVA',
        last4: '4821',
        type: 'credit',
        creditLimit: 100,
        cutoffDay: 1,
        dueDay: 20,
      };
      for (const [body, field] of [
        [{ ...base, alias: 'Uno', cvv: '123' }, null],
        [{ ...base, alias: 'Dos', pin: '1234' }, null],
        [{ ...base, alias: 'Tres', cardNumber: '4111111111111111' }, null],
        [{ ...base, alias: '4111 1111 1111 1111' }, 'alias'],
        [{ ...base, alias: 'Cuatro', last4: '41111' }, 'last4'],
      ] as const) {
        const response = await ana.client.post('/cards').send(body).expect(422);
        if (field) {
          expect(response.body.error.fields).toHaveProperty([field]);
        }
      }
      // Y el mismo cuerpo sin lo agregado sí entra: cada caso falló por lo suyo.
      await ana.client.post('/cards').send(base).expect(201);
      const [{ total }] = await testApp.dataSource.query(
        `SELECT count(*)::int AS total FROM tarjetas t JOIN usuarios u ON u.id = t.usuario_id
         WHERE u.cognito_sub = 'sub-rnf3'`,
      );
      expect(total).toBe(1);
    });
  });

  describe('Zonas horarias extremas', () => {
    it('"hoy" es el del usuario: en Kiritimati (UTC+14) y en Pago Pago (UTC−11)', async () => {
      for (const timeZone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        const sub = `sub-zona-${timeZone.split('/')[1]}`;
        const user = await setUpUser(testApp, sub, {
          debitBalance: 100,
          initialBalanceDate: addDays(todayIn(timeZone), -1),
        });
        await user.client.patch('/me').send({ timeZone }).expect(200);
        const local = todayIn(timeZone);
        await postTransaction(
          user.client,
          expense(user.debitId, 1, { date: local }),
        ).expect(201);
        const future = await postTransaction(
          user.client,
          expense(user.debitId, 1, { date: addDays(local, 1) }),
        ).expect(422);
        expect(future.body.error.fields).toHaveProperty('date');
      }
    });
  });
});
