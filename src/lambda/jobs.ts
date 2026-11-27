import { Logger, type INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runDailyJob, type DailyJobSummary } from '../jobs/daily.job';

/**
 * Invocaciones directas de la Lambda, que no pasan por API Gateway. La base
 * está en subredes privadas, así que GitHub Actions no llega a ella: el
 * pipeline invoca estos jobs (docs/despliegue.md).
 * - `{"job": "daily"}`: EventBridge Scheduler, una vez al día (§3.7).
 * - `{"job": "migrate"}`: el despliegue, con la versión nueva antes de que
 *   reciba tráfico.
 * - `{"job": "bootstrap"}`: el despliegue, en la Lambda mincome-backend-db-bootstrap,
 *   que entra como el usuario maestro. Crea al usuario de la app.
 *
 * Invocarla así pide permiso IAM `lambda:InvokeFunction`.
 */
export type JobEvent =
  { job: 'daily' } | { job: 'migrate' } | { job: 'bootstrap' };

const JOBS = new Set(['daily', 'migrate', 'bootstrap']);

export interface MigrationsSummary {
  applied: string[];
}

export interface BootstrapSummary {
  appUser: string;
  /** false si ya existía. */
  created: boolean;
  /** rds_iam solo existe en RDS: localmente queda en false. */
  iamAuth: boolean;
}

/** Los identificadores no van como parámetro de SQL: solo se aceptan nombres simples. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

const logger = new Logger('LambdaJobs');

export function isJobEvent(event: unknown): event is JobEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const { job } = event as { job?: unknown };
  return typeof job === 'string' && JOBS.has(job);
}

export async function runMigrations(
  app: INestApplicationContext,
): Promise<MigrationsSummary> {
  const migrations = await app.get(DataSource).runMigrations();
  const summary = { applied: migrations.map((migration) => migration.name) };
  logger.log(JSON.stringify(summary));
  return summary;
}

function identifierFrom(name: string): string {
  const value = process.env[name];
  if (!value || !IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a simple PostgreSQL identifier`);
  }
  return `"${value}"`;
}

/**
 * Crea al usuario de la app, le da rds_iam (IAM de punta a punta con RDS
 * Proxy, sin contraseña) y lo hace dueño de la base, para que las migraciones
 * creen tablas y las extensiones confiables (pg_trgm, unaccent). Correrlo otra
 * vez no cambia nada.
 *
 * Solo corre donde DB_BOOTSTRAP_ENABLED=true: la Lambda de bootstrap, cuyo rol
 * es el único que puede entrar como el usuario maestro.
 */
export async function runDatabaseBootstrap(
  app: INestApplicationContext,
): Promise<BootstrapSummary> {
  if (process.env.DB_BOOTSTRAP_ENABLED !== 'true') {
    throw new Error('The bootstrap job only runs in the db-bootstrap function');
  }
  const appUser = identifierFrom('DB_APP_USER');
  const database = identifierFrom('DB_NAME');
  const dataSource = app.get(DataSource);

  const existing: unknown[] = await dataSource.query(
    `SELECT 1 FROM pg_roles WHERE rolname = $1`,
    [process.env.DB_APP_USER],
  );
  const created = existing.length === 0;
  if (created) {
    await dataSource.query(`CREATE ROLE ${appUser} LOGIN`);
  }
  const [{ iamAuth }]: { iamAuth: boolean }[] = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') AS "iamAuth"`,
  );
  if (iamAuth) {
    await dataSource.query(`GRANT rds_iam TO ${appUser}`);
  }
  // Para pasarle la base, quien la tiene debe ser miembro del nuevo dueño.
  await dataSource.query(`GRANT ${appUser} TO CURRENT_USER`);
  await dataSource.query(`ALTER DATABASE ${database} OWNER TO ${appUser}`);

  const summary = {
    appUser: process.env.DB_APP_USER as string,
    created,
    iamAuth,
  };
  logger.log(JSON.stringify(summary));
  return summary;
}

export function runJob(
  app: INestApplicationContext,
  event: JobEvent,
): Promise<DailyJobSummary | MigrationsSummary | BootstrapSummary> {
  switch (event.job) {
    case 'daily':
      return runDailyJob(app);
    case 'migrate':
      return runMigrations(app);
    case 'bootstrap':
      return runDatabaseBootstrap(app);
  }
}
