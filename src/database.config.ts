import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';
import { types } from 'pg';
import type { DataSourceOptions } from 'typeorm';

// `pg` convierte DATE en un Date de JavaScript con la zona horaria del
// servidor, lo que puede mover el día. Las fechas se manejan como texto
// 'YYYY-MM-DD' en toda la aplicación.
types.setTypeParser(types.builtins.DATE, (value) => value);

function getEnvironmentVariable(
  name: string,
  configService?: ConfigService,
): string | undefined {
  return configService?.get<string>(name) ?? process.env[name];
}

function getRequiredEnvironmentVariable(
  name: string,
  configService?: ConfigService,
): string {
  const value = getEnvironmentVariable(name, configService)?.trim();

  if (!value) {
    throw new Error(`Missing required database environment variable: ${name}`);
  }

  return value;
}

function getPositiveIntegerEnvironmentVariable(
  name: string,
  defaultValue: number,
  configService?: ConfigService,
): number {
  const value = getEnvironmentVariable(name, configService);

  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Database environment variable ${name} must be a positive integer`,
    );
  }

  return parsedValue;
}

// Con tsx (CLI de TypeORM en desarrollo) se cargan los .ts de src/; ya
// compilado, los .js de dist/. No se usa '*.{ts,js}' porque dist/ también
// tiene los .d.ts.
const MIGRATIONS_GLOB = join(
  __dirname,
  'database',
  'migrations',
  __filename.endsWith('.ts') ? '*.ts' : '*.js',
);

/** Lo que comparten la aplicación y el CLI de TypeORM. */
export function createDataSourceOptions(
  configService?: ConfigService,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: getRequiredEnvironmentVariable('DB_HOST', configService),
    port: getPositiveIntegerEnvironmentVariable('DB_PORT', 5432, configService),
    database: getRequiredEnvironmentVariable('DB_NAME', configService),
    username: getRequiredEnvironmentVariable('DB_USER', configService),
    password: getRequiredEnvironmentVariable('DB_PASSWORD', configService),
    synchronize: false,
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'migraciones',
    extra: {
      max: getPositiveIntegerEnvironmentVariable(
        'DB_POOL_MAX',
        20,
        configService,
      ),
      min: getPositiveIntegerEnvironmentVariable(
        'DB_POOL_MIN',
        2,
        configService,
      ),
      idleTimeoutMillis: getPositiveIntegerEnvironmentVariable(
        'DB_POOL_IDLE_TIMEOUT_MS',
        30000,
        configService,
      ),
      connectionTimeoutMillis: getPositiveIntegerEnvironmentVariable(
        'DB_CONNECTION_TIMEOUT_MS',
        5000,
        configService,
      ),
    },
  };
}

export function createDatabaseConfig(
  configService?: ConfigService,
): TypeOrmModuleOptions {
  return {
    ...createDataSourceOptions(configService),
    autoLoadEntities: true,
    retryAttempts: getPositiveIntegerEnvironmentVariable(
      'DB_RETRY_ATTEMPTS',
      5,
      configService,
    ),
    retryDelay: getPositiveIntegerEnvironmentVariable(
      'DB_RETRY_DELAY_MS',
      3000,
      configService,
    ),
  };
}
