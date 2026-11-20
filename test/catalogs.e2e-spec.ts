import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Categorías y cuentas (e2e)', () => {
  let testApp: TestApp;
  const ana = { sub: 'sub-ana', name: 'Ana' };
  const beto = { sub: 'sub-beto', name: 'Beto' };

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
  });

  afterAll(() => testApp.close());

  describe('GET /categories', () => {
    it('regresa las 16 del sistema en el orden de la semilla', async () => {
      const response = await testApp.as(ana).get('/categories').expect(200);
      expect(response.body).toHaveLength(16);
      expect(response.body[0]).toEqual({
        id: 1,
        name: 'Comida',
        icon: 'utensils-crossed',
        appliesTo: 'expense',
        isSystem: true,
        isActive: true,
      });
      expect(response.body[10]).toMatchObject({
        id: 11,
        name: 'Nómina',
        appliesTo: 'income',
      });
    });

    it('filtra por tipo e incluye las de "ambos"', async () => {
      await testApp
        .as(ana)
        .post('/categories')
        .send({ name: 'Regalos', icon: 'gift', appliesTo: 'both' })
        .expect(201);
      const response = await testApp
        .as(ana)
        .get('/categories?appliesTo=income')
        .expect(200);
      const names = response.body.map(
        (category: { name: string }) => category.name,
      );
      expect(names).toContain('Nómina');
      expect(names).toContain('Regalos');
      expect(names).not.toContain('Comida');
    });
  });

  describe('POST y PATCH /categories', () => {
    it('crea una categoría del usuario', async () => {
      const response = await testApp
        .as(ana)
        .post('/categories')
        .send({ name: 'Mascotas', icon: 'paw-print', appliesTo: 'expense' })
        .expect(201);
      expect(response.body).toEqual({
        id: expect.any(Number),
        name: 'Mascotas',
        icon: 'paw-print',
        appliesTo: 'expense',
        isSystem: false,
        isActive: true,
      });
    });

    it('no repite el nombre de una del sistema sin distinguir mayúsculas', async () => {
      const response = await testApp
        .as(ana)
        .post('/categories')
        .send({ name: 'comida', appliesTo: 'expense' })
        .expect(409);
      expect(response.body.error).toMatchObject({
        code: 'conflict',
        fields: { name: expect.any(String) },
      });
    });

    it('otro usuario puede usar el mismo nombre', async () => {
      await testApp
        .as(beto)
        .post('/categories')
        .send({ name: 'Mascotas', appliesTo: 'expense' })
        .expect(201);
    });

    it('oculta una categoría y no deja editar las del sistema', async () => {
      const created = await testApp
        .as(ana)
        .post('/categories')
        .send({ name: 'Viajes', appliesTo: 'expense' })
        .expect(201);
      await testApp
        .as(ana)
        .patch(`/categories/${created.body.id}`)
        .send({ name: 'Viajes y paseos', isActive: false })
        .expect(200, {
          ...created.body,
          name: 'Viajes y paseos',
          isActive: false,
        });

      const visible = await testApp.as(ana).get('/categories').expect(200);
      expect(visible.body.map((c: { name: string }) => c.name)).not.toContain(
        'Viajes y paseos',
      );
      const all = await testApp
        .as(ana)
        .get('/categories?includeInactive=true')
        .expect(200);
      expect(all.body.map((c: { name: string }) => c.name)).toContain(
        'Viajes y paseos',
      );

      const system = await testApp
        .as(ana)
        .patch('/categories/1')
        .send({ name: 'Comidas' })
        .expect(403);
      expect(system.body.error.code).toBe('not_editable');
    });

    it('responde 404 por la categoría de otro usuario', async () => {
      const betoCategory = await testApp
        .as(beto)
        .post('/categories')
        .send({ name: 'Privada', appliesTo: 'expense' })
        .expect(201);
      await testApp
        .as(ana)
        .patch(`/categories/${betoCategory.body.id}`)
        .send({ name: 'X' })
        .expect(404);
      await testApp
        .as(ana)
        .patch('/categories/abc')
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('/accounts', () => {
    it('el usuario empieza con su cuenta Efectivo en 0', async () => {
      const response = await testApp.as(ana).get('/accounts').expect(200);
      expect(response.body).toEqual([
        {
          id: expect.any(String),
          name: 'Efectivo',
          type: 'cash',
          balance: 0,
          initialBalance: 0,
          initialBalanceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          isActive: true,
          cards: [],
        },
      ]);
    });

    it('crea una cuenta de débito con saldo inicial', async () => {
      const response = await testApp
        .as(ana)
        .post('/accounts')
        .send({
          name: 'Nómina Santander',
          type: 'debit',
          initialBalance: 3000,
          initialBalanceDate: '2026-08-01',
        })
        .expect(201);
      expect(response.body).toMatchObject({
        name: 'Nómina Santander',
        type: 'debit',
        balance: 3000,
        initialBalance: 3000,
        initialBalanceDate: '2026-08-01',
      });
    });

    it('no crea cuentas de crédito ni nombres repetidos ni fechas futuras', async () => {
      await testApp
        .as(ana)
        .post('/accounts')
        .send({ name: 'Crédito', type: 'credit' })
        .expect(422);
      await testApp
        .as(ana)
        .post('/accounts')
        .send({ name: 'nómina santander', type: 'debit' })
        .expect(409);
      await testApp
        .as(ana)
        .post('/accounts')
        .send({
          name: 'Futuro',
          type: 'cash',
          initialBalanceDate: '2999-01-01',
        })
        .expect(422);
      await testApp
        .as(ana)
        .post('/accounts')
        .send({ name: 'Negativa', type: 'cash', initialBalance: -5 })
        .expect(422);
    });

    it('edita nombre y saldo inicial, y desactiva', async () => {
      const created = await testApp
        .as(ana)
        .post('/accounts')
        .send({ name: 'Cartera', type: 'cash', initialBalance: 100 })
        .expect(201);
      const updated = await testApp
        .as(ana)
        .patch(`/accounts/${created.body.id}`)
        .send({ name: 'Cartera roja', initialBalance: 150.5 })
        .expect(200);
      expect(updated.body).toMatchObject({
        name: 'Cartera roja',
        initialBalance: 150.5,
        balance: 150.5,
      });

      await testApp
        .as(ana)
        .patch(`/accounts/${created.body.id}`)
        .send({ isActive: false })
        .expect(200);
      const active = await testApp.as(ana).get('/accounts').expect(200);
      expect(active.body.map((a: { name: string }) => a.name)).not.toContain(
        'Cartera roja',
      );
      const all = await testApp
        .as(ana)
        .get('/accounts?includeInactive=true')
        .expect(200);
      expect(all.body.map((a: { name: string }) => a.name)).toContain(
        'Cartera roja',
      );
    });

    it('responde 404 por la cuenta de otro usuario', async () => {
      const [anaCash] = (await testApp.as(ana).get('/accounts').expect(200))
        .body;
      await testApp
        .as(beto)
        .patch(`/accounts/${anaCash.id}`)
        .send({ name: 'Mía' })
        .expect(404);
    });
  });
});
