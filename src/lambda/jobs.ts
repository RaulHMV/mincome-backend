import { Logger, type INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runDailyJob, type DailyJobSummary } from '../jobs/daily.job';

/**
 * Invocaciones directas de la Lambda, que no pasan por API Gateway:
 * - `{"job": "daily"}`: EventBridge Scheduler, una vez al día (§3.7).
 * - `{"job": "migrate"}`: el despliegue, después de `sam deploy`. La base está
 *   en subredes privadas, así que GitHub Actions no llega a ella directo.
 *
 * Invocarla así pide permiso IAM `lambda:InvokeFunction`.
 */
export type JobEvent = { job: 'daily' } | { job: 'migrate' };

export interface MigrationsSummary {
  applied: string[];
}

const logger = new Logger('LambdaJobs');

export function isJobEvent(event: unknown): event is JobEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const { job } = event as { job?: unknown };
  return job === 'daily' || job === 'migrate';
}

export async function runMigrations(
  app: INestApplicationContext,
): Promise<MigrationsSummary> {
  const migrations = await app.get(DataSource).runMigrations();
  const summary = { applied: migrations.map((migration) => migration.name) };
  logger.log(JSON.stringify(summary));
  return summary;
}

export function runJob(
  app: INestApplicationContext,
  event: JobEvent,
): Promise<DailyJobSummary | MigrationsSummary> {
  return event.job === 'daily' ? runDailyJob(app) : runMigrations(app);
}
