import { accessTokenFor, signToken } from './support/tokens';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('Autenticación, GET /me y GET /plans (e2e)', () => {
  let testApp: TestApp;
  const valeria = {
    sub: 'sub-valeria',
    email: 'valeria@correo.com',
    name: 'Valeria Zapata',
  };

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
  });

  afterAll(() => testApp.close());

  it('responde la salud sin token', async () => {
    await testApp
      .anonymous()
      .get('/api/v1/health')
      .expect(200, { status: 'ok' });
  });

  it('rechaza una petición sin token con la forma de error del contrato', async () => {
    const response = await testApp.anonymous().get('/api/v1/me').expect(401);
    expect(response.body).toEqual({
      error: {
        code: 'unauthenticated',
        message: expect.any(String),
        fields: null,
      },
    });
  });

  it('rechaza un token con otra firma o vencido', async () => {
    const forged = `${signToken({ sub: 'x', token_use: 'id', aud: 'test-client-id' }).slice(0, -4)}AAAA`;
    await testApp
      .anonymous()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    const expired = signToken({
      sub: 'x',
      token_use: 'id',
      aud: 'test-client-id',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    await testApp
      .anonymous()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('rechaza un token de otro app client', async () => {
    const token = signToken({
      sub: 'x',
      token_use: 'id',
      aud: 'otro-cliente',
      email: 'x@correo.com',
      name: 'X',
    });
    await testApp
      .anonymous()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('crea al usuario en su primer GET /me, con plan normal y cuenta Efectivo', async () => {
    const response = await testApp.as(valeria).get('/me').expect(200);

    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'Valeria Zapata',
      email: 'valeria@correo.com',
      currency: 'MXN',
      timeZone: 'America/Mexico_City',
      termsVersion: null,
      lastLoginAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[56]:00$/,
      ),
      createdAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[56]:00$/,
      ),
      plan: {
        id: 1,
        name: 'normal',
        monthlyPrice: 0,
        includesAssistant: false,
        monthlyQueryLimit: 0,
        monthlyTokenLimit: 0,
      },
      aiUsage: {
        period: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        queriesUsed: 0,
        tokensUsed: 0,
      },
    });

    const accounts: { nombre: string; tipo: string }[] =
      await testApp.dataSource.query(
        'SELECT nombre, tipo FROM cuentas WHERE usuario_id = $1',
        [response.body.id],
      );
    expect(accounts).toEqual([{ nombre: 'Efectivo', tipo: 'efectivo' }]);
  });

  it('no duplica al usuario en peticiones posteriores', async () => {
    await testApp.as(valeria).get('/me').expect(200);
    const [{ total }] = await testApp.dataSource.query(
      "SELECT count(*)::int AS total FROM usuarios WHERE cognito_sub = 'sub-valeria'",
    );
    expect(total).toBe(1);
  });

  it('toma el plan del grupo de Cognito y sincroniza usuarios.plan_id', async () => {
    const response = await testApp
      .as({ ...valeria, groups: ['premium'] })
      .get('/me')
      .expect(200);
    expect(response.body.plan).toMatchObject({
      name: 'premium',
      includesAssistant: true,
    });

    const [{ plan }] = await testApp.dataSource.query(
      "SELECT p.nombre AS plan FROM usuarios u JOIN planes p ON p.id = u.plan_id WHERE u.cognito_sub = 'sub-valeria'",
    );
    expect(plan).toBe('premium');
  });

  it('acepta el access token de un usuario que ya existe', async () => {
    await testApp
      .anonymous()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessTokenFor(valeria)}`)
      .expect(200);
  });

  it('no puede crear al usuario con un access token, que no trae nombre ni correo', async () => {
    await testApp
      .anonymous()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessTokenFor({ sub: 'sub-nuevo' })}`)
      .expect(401);
  });

  it('guarda la versión de los términos del registro', async () => {
    const response = await testApp
      .as({
        sub: 'sub-carlos',
        email: 'carlos@correo.com',
        name: 'Carlos',
        termsVersion: '2026-11',
      })
      .get('/me')
      .expect(200);
    expect(response.body.termsVersion).toBe('2026-11');
  });

  it('PATCH /me cambia nombre, zona horaria y términos', async () => {
    const response = await testApp
      .as(valeria)
      .patch('/me')
      .send({
        name: '  Valeria Z.  ',
        timeZone: 'America/Tijuana',
        termsVersion: '2026-12',
      })
      .expect(200);
    expect(response.body).toMatchObject({
      name: 'Valeria Z.',
      timeZone: 'America/Tijuana',
      termsVersion: '2026-12',
    });
  });

  it('PATCH /me valida cada campo y responde 422 con errores por campo', async () => {
    const response = await testApp
      .as(valeria)
      .patch('/me')
      .send({ name: '', timeZone: 'Marte/Olimpo' })
      .expect(422);
    expect(response.body.error).toEqual({
      code: 'validation_error',
      message: 'Revisa los campos marcados.',
      fields: {
        name: 'Es obligatorio',
        timeZone: expect.stringContaining('zona horaria'),
      },
    });
  });

  it('GET /plans regresa los planes activos', async () => {
    const response = await testApp.as(valeria).get('/plans').expect(200);
    expect(response.body.map((plan: { name: string }) => plan.name)).toEqual([
      'normal',
      'premium',
    ]);
  });

  it('responde 404 con la forma del contrato en una ruta que no existe', async () => {
    const response = await testApp.as(valeria).get('/no-existe').expect(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
