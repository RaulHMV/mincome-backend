import type { APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../src/database.config';
import { MIGRATIONS } from '../src/database/migrations';
import type * as LambdaModule from '../src/lambda';
import { expense } from './support/fixtures';
import { TEST_ISSUER } from './support/tokens';

// La Lambda tal como la invoca AWS: eventos de API Gateway HTTP API (payload
// 2.0) con los claims que ya validó el autorizador JWT, el trigger de Cognito
// y las invocaciones directas de EventBridge Scheduler y del despliegue.
//
// Con LAMBDA_BUNDLE=dist-lambda/lambda.js prueba el paquete que se sube a AWS
// (npm run test:lambda-bundle) en vez del código fuente.

/**
 * El paquete se copia a una carpeta temporal sin node_modules arriba, como
 * /var/task en Lambda: así un `require` que el paquete no trae falla aquí
 * igual que fallaría en AWS, en vez de encontrar el node_modules del repo.
 */
function loadLambda(): typeof LambdaModule {
  const bundle = process.env.LAMBDA_BUNDLE;
  if (!bundle) {
    return jest.requireActual('../src/lambda');
  }
  const source = resolve(dirname(bundle));
  const target = mkdtempSync(join(tmpdir(), 'mincome-lambda-'));
  cpSync(source, target, { recursive: true });
  return jest.requireActual(join(target, basename(bundle)));
}

const { closeApp, handler } = loadLambda();

const CONTEXT = { awsRequestId: 'test-request' } as Context;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID as string;

interface HttpRequest {
  method: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Lo que el autorizador JWT pone en requestContext.authorizer.jwt.claims. */
  claims?: Record<string, string>;
}

interface HttpResponse {
  status: number;
  headers: Record<string, unknown>;
  body: any;
}

function claimsFor(
  sub: string,
  changes: Record<string, string> = {},
): Record<string, string> {
  // Así los manda HTTP API: todo como texto, los arreglos como "[a b]".
  return {
    sub,
    iss: TEST_ISSUER,
    aud: 'test-client-id',
    token_use: 'id',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    email: `${sub}@example.com`,
    name: 'Ana Lambda',
    'cognito:groups': '[premium]',
    ...changes,
  };
}

async function invokeHttp(request: HttpRequest): Promise<HttpResponse> {
  const event = {
    version: '2.0',
    routeKey: '$default',
    rawPath: request.path,
    rawQueryString: request.query ?? '',
    headers: {
      'content-type': 'application/json',
      ...request.headers,
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: request.method,
        path: request.path,
        protocol: 'HTTP/1.1',
        sourceIp: '203.0.113.10',
        userAgent: 'jest',
      },
      requestId: randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      ...(request.claims
        ? { authorizer: { jwt: { claims: request.claims, scopes: null } } }
        : {}),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    isBase64Encoded: false,
  };
  const result = (await handler(
    event,
    CONTEXT,
  )) as APIGatewayProxyStructuredResultV2;
  const text = result.isBase64Encoded
    ? Buffer.from(result.body ?? '', 'base64').toString('utf8')
    : (result.body ?? '');
  return {
    status: result.statusCode ?? 0,
    headers: result.headers ?? {},
    body: text ? JSON.parse(text) : null,
  };
}

function postConfirmation(
  triggerSource: string,
  attributes: Record<string, string>,
) {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: USER_POOL_ID,
    userName: attributes.sub,
    triggerSource,
    callerContext: { awsSdkVersion: 'test', clientId: 'test-client-id' },
    request: { userAttributes: attributes },
    response: {},
  };
}

describe('Lambda (e2e)', () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeAll(async () => {
    // Base vacía: las migraciones las corre la propia Lambda.
    const dataSource = new DataSource(createDataSourceOptions());
    await dataSource.initialize();
    await dataSource.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await dataSource.destroy();
    process.env.AUTH_MODE = 'api-gateway';
  });

  afterAll(async () => {
    await closeApp();
    process.env.AUTH_MODE = originalAuthMode;
  });

  it('{"job": "migrate"} corre las migraciones pendientes', async () => {
    await expect(handler({ job: 'migrate' }, CONTEXT)).resolves.toEqual({
      applied: MIGRATIONS.map((migration) => migration.name),
    });
    await expect(handler({ job: 'migrate' }, CONTEXT)).resolves.toEqual({
      applied: [],
    });
  });

  it('el trigger Post confirmation crea al usuario y regresa el evento', async () => {
    const event = postConfirmation('PostConfirmation_ConfirmSignUp', {
      sub: 'sub-ana-lambda',
      email: 'ana.lambda@example.com',
      name: 'Ana Lambda',
      'custom:terminos_version': '2026-01',
    });
    await expect(handler(event, CONTEXT)).resolves.toEqual(event);

    const me = await invokeHttp({
      method: 'GET',
      path: '/api/v1/me',
      claims: claimsFor('sub-ana-lambda', { email: 'ana.lambda@example.com' }),
    });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      name: 'Ana Lambda',
      email: 'ana.lambda@example.com',
      termsVersion: '2026-01',
      // "[premium]" del autorizador de HTTP API.
      plan: { name: 'premium' },
    });
  });

  it('el trigger de "olvidé mi contraseña" no hace nada', async () => {
    const event = postConfirmation('PostConfirmation_ConfirmForgotPassword', {
      sub: 'sub-olvido',
      email: 'olvido@example.com',
      name: 'Olvido',
    });
    await expect(handler(event, CONTEXT)).resolves.toEqual(event);
  });

  it('confía en los claims de API Gateway solo si son de nuestro pool y app client', async () => {
    const withoutAuthorizer = await invokeHttp({
      method: 'GET',
      path: '/api/v1/me',
      // Aunque traiga un header, sin autorizador no se confía en nada.
      headers: { authorization: 'Bearer cualquier-cosa' },
    });
    expect(withoutAuthorizer.status).toBe(401);
    expect(withoutAuthorizer.body.error.code).toBe('unauthenticated');

    const rejected: Record<string, string>[] = [
      { aud: 'otro-client' },
      { iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Otro' },
      { exp: String(Math.floor(Date.now() / 1000) - 1) },
    ];
    for (const changes of rejected) {
      const response = await invokeHttp({
        method: 'GET',
        path: '/api/v1/me',
        claims: claimsFor('sub-ana-lambda', changes),
      });
      expect(response.status).toBe(401);
    }
  });

  it('las rutas públicas no piden autorizador', async () => {
    const health = await invokeHttp({ method: 'GET', path: '/api/v1/health' });
    expect(health.status).toBe(200);
  });

  it('pasa query, body y headers; Idempotency-Key repite la respuesta sin mover dinero otra vez', async () => {
    const claims = claimsFor('sub-ana-lambda');
    const categories = await invokeHttp({
      method: 'GET',
      path: '/api/v1/categories',
      query: 'appliesTo=income',
      claims,
    });
    expect(categories.status).toBe(200);
    expect(categories.body.length).toBeGreaterThan(0);

    const account = await invokeHttp({
      method: 'POST',
      path: '/api/v1/accounts',
      body: { name: 'Nómina', type: 'debit', initialBalance: 1000 },
      claims,
    });
    expect(account.status).toBe(201);

    const key = randomUUID();
    const pay = () =>
      invokeHttp({
        method: 'POST',
        path: '/api/v1/transactions',
        headers: { 'idempotency-key': key },
        body: expense(account.body.id, 150),
        claims,
      });
    const first = await pay();
    expect(first.status).toBe(201);
    const retry = await pay();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    const accounts = await invokeHttp({
      method: 'GET',
      path: '/api/v1/accounts',
      claims,
    });
    expect(
      accounts.body.find((item: { id: string }) => item.id === account.body.id)
        .balance,
    ).toBe(850);
  });

  it('{"job": "daily"} corre el proceso diario', async () => {
    await expect(handler({ job: 'daily' }, CONTEXT)).resolves.toMatchObject({
      recurringTransactions: expect.any(Object),
      prunedIdempotencyKeys: expect.any(Number),
    });
  });

  it('rechaza un evento que no conoce', async () => {
    await expect(handler({ job: 'borrar-todo' }, CONTEXT)).rejects.toThrow(
      'Unsupported Lambda event',
    );
  });
});
