import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { types } from 'pg';
import type { DataSourceOptions } from 'typeorm';
import { MIGRATIONS } from './database/migrations';

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

function getIntegerEnvironmentVariable(
  name: string,
  defaultValue: number,
  { min, configService }: { min: 0 | 1; configService?: ConfigService },
): number {
  const value = getEnvironmentVariable(name, configService);

  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < min) {
    throw new Error(
      `Database environment variable ${name} must be ${min === 0 ? 'a non-negative' : 'a positive'} integer`,
    );
  }

  return parsedValue;
}

function getPositiveIntegerEnvironmentVariable(
  name: string,
  defaultValue: number,
  configService?: ConfigService,
): number {
  return getIntegerEnvironmentVariable(name, defaultValue, {
    min: 1,
    configService,
  });
}

function getBooleanEnvironmentVariable(
  name: string,
  defaultValue: boolean,
  configService?: ConfigService,
): boolean {
  const value = getEnvironmentVariable(name, configService)?.trim();
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error(
      `Database environment variable ${name} must be true or false`,
    );
  }
  return value === 'true';
}

function runsOnLambda(configService?: ConfigService): boolean {
  return Boolean(
    getEnvironmentVariable('AWS_LAMBDA_FUNCTION_NAME', configService),
  );
}

/**
 * TLS verificando el certificado. RDS Proxy usa certificados de ACM, que
 * Node ya reconoce; para conectarse directo a RDS hace falta el bundle de
 * AWS en DB_SSL_CA_FILE.
 */
function createSslOptions(configService?: ConfigService) {
  if (
    !getBooleanEnvironmentVariable(
      'DB_SSL',
      runsOnLambda(configService),
      configService,
    )
  ) {
    return false;
  }
  const caFile = getEnvironmentVariable('DB_SSL_CA_FILE', configService);
  return {
    rejectUnauthorized: true,
    ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}),
  };
}

/**
 * Lo que comparten la aplicación y el CLI de TypeORM.
 *
 * En Lambda cada instancia atiende una petición a la vez y RDS Proxy reparte
 * las conexiones, así que el pool por instancia es chico y sin mínimo.
 */
export function createDataSourceOptions(
  configService?: ConfigService,
): DataSourceOptions {
  const onLambda = runsOnLambda(configService);
  return {
    type: 'postgres',
    host: getRequiredEnvironmentVariable('DB_HOST', configService),
    port: getPositiveIntegerEnvironmentVariable('DB_PORT', 5432, configService),
    database: getRequiredEnvironmentVariable('DB_NAME', configService),
    username: getRequiredEnvironmentVariable('DB_USER', configService),
    password: getRequiredEnvironmentVariable('DB_PASSWORD', configService),
    synchronize: false,
    migrations: MIGRATIONS,
    migrationsTableName: 'migraciones',
    ssl: createSslOptions(configService),
    extra: {
      max: getPositiveIntegerEnvironmentVariable(
        'DB_POOL_MAX',
        onLambda ? 2 : 20,
        configService,
      ),
      min: getIntegerEnvironmentVariable('DB_POOL_MIN', onLambda ? 0 : 2, {
        min: 0,
        configService,
      }),
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
  // En Lambda, API Gateway corta a los 30 s: más vale fallar rápido.
  const onLambda = runsOnLambda(configService);
  return {
    ...createDataSourceOptions(configService),
    autoLoadEntities: true,
    retryAttempts: getIntegerEnvironmentVariable(
      'DB_RETRY_ATTEMPTS',
      onLambda ? 1 : 5,
      { min: 0, configService },
    ),
    retryDelay: getPositiveIntegerEnvironmentVariable(
      'DB_RETRY_DELAY_MS',
      onLambda ? 1000 : 3000,
      configService,
    ),
  };
}
