import { ConfigService } from '@nestjs/config';
import { createDatabaseConfig } from './database.config';

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
});
