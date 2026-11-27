import { ConfigService } from '@nestjs/config';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { types } from 'pg';
import { MIGRATIONS } from './database/migrations';
import {
  createDatabaseConfig,
  createDataSourceOptions,
} from './database.config';

describe('createDatabaseConfig', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      DB_HOST: 'database.example.com',
      DB_NAME: 'mincome',
      DB_USER: 'mincome_app',
      DB_PASSWORD: 'secret',
    };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('configures a PostgreSQL pool for concurrent requests', () => {
    expect(createDatabaseConfig()).toMatchObject({
      type: 'postgres',
      host: 'database.example.com',
      port: 5432,
      database: 'mincome',
      username: 'mincome_app',
      password: 'secret',
      synchronize: false,
      retryAttempts: 5,
      extra: {
        max: 20,
        min: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      },
    });
  });

  it('sizes the pool for Lambda behind RDS Proxy and requires TLS', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'mincome-backend';

    expect(createDatabaseConfig()).toMatchObject({
      retryAttempts: 1,
      retryDelay: 1000,
      ssl: { rejectUnauthorized: true },
      extra: { max: 2, min: 0 },
    });
  });

  it('connects without TLS locally unless DB_SSL is true', () => {
    expect(createDataSourceOptions()).toMatchObject({ ssl: false });

    process.env.DB_SSL = 'true';
    expect(createDataSourceOptions()).toMatchObject({
      ssl: { rejectUnauthorized: true },
    });

    process.env.DB_SSL = 'yes';
    expect(() => createDataSourceOptions()).toThrow(
      'DB_SSL must be true or false',
    );
  });

  it('signs an RDS Proxy IAM token instead of reading DB_PASSWORD', async () => {
    delete process.env.DB_PASSWORD;
    Object.assign(process.env, {
      DB_IAM_AUTH: 'true',
      DB_SSL: 'true',
      AWS_REGION: 'us-east-1',
      // Credenciales falsas: el token se firma localmente, sin red.
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });

    const { password } = createDataSourceOptions() as { password: unknown };
    expect(password).toBeInstanceOf(Function);
    const token = await (password as () => Promise<string>)();
    expect(token).toMatch(
      /^database\.example\.com:5432\/\?Action=connect&DBUser=mincome_app&/,
    );
    expect(token).toContain('X-Amz-Signature=');

    process.env.DB_SSL = 'false';
    expect(() => createDataSourceOptions()).toThrow(
      'DB_IAM_AUTH needs DB_SSL=true',
    );
  });

  it('rejects an invalid pool size', () => {
    process.env.DB_POOL_MAX = '0';

    expect(() => createDatabaseConfig()).toThrow(
      'DB_POOL_MAX must be a positive integer',
    );
  });

  it('rejects missing credentials', () => {
    delete process.env.DB_PASSWORD;

    expect(() => createDatabaseConfig()).toThrow(
      'Missing required database environment variable: DB_PASSWORD',
    );
  });

  it('supports ConfigService values and custom pool settings', () => {
    const configService = new ConfigService({
      DB_HOST: 'db.internal',
      DB_PORT: '5433',
      DB_NAME: 'mincome_test',
      DB_USER: 'test_app',
      DB_PASSWORD: 'test_secret',
      DB_POOL_MAX: '10',
      DB_POOL_MIN: '3',
      DB_POOL_IDLE_TIMEOUT_MS: '15000',
      DB_CONNECTION_TIMEOUT_MS: '2500',
      DB_RETRY_ATTEMPTS: '8',
      DB_RETRY_DELAY_MS: '1000',
    });

    expect(createDatabaseConfig(configService)).toMatchObject({
      type: 'postgres',
      host: 'db.internal',
      port: 5433,
      database: 'mincome_test',
      username: 'test_app',
      password: 'test_secret',
      retryAttempts: 8,
      retryDelay: 1000,
      extra: {
        max: 10,
        min: 3,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 2500,
      },
    });
  });

  it('rejects non-integer numeric configuration', () => {
    process.env.DB_PORT = '5432.5';

    expect(() => createDatabaseConfig()).toThrow(
      'DB_PORT must be a positive integer',
    );
  });

  it('shares the migrations with the TypeORM CLI', () => {
    const options = createDataSourceOptions();

    expect(options.migrationsTableName).toBe('migraciones');
    expect(options.migrations).toBe(MIGRATIONS);
    expect(options).not.toHaveProperty('autoLoadEntities');
  });

  it('lists every migration file, in order', () => {
    const directory = join(__dirname, 'database', 'migrations');
    const files = readdirSync(directory)
      .filter((file) => /^\d+-\w+\.ts$/.test(file))
      .sort();

    expect(MIGRATIONS.map((migration) => migration.name)).toEqual(
      files.map((file) => {
        const [timestamp, name] = file.replace(/\.ts$/, '').split('-');
        return `${name}${timestamp}`;
      }),
    );
  });

  it('reads DATE columns as YYYY-MM-DD text', () => {
    expect(types.getTypeParser(types.builtins.DATE)('2026-10-24')).toBe(
      '2026-10-24',
    );
  });
});
