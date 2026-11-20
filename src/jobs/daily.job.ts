import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TypeOrmIdempotencyStore } from '../idempotency/typeorm-idempotency.store';
import {
  RecurringTransactionsService,
  type RecurringRunSummary,
} from '../recurring-transactions/recurring-transactions.service';

export interface DailyJobSummary {
  recurringTransactions: RecurringRunSummary;
  prunedIdempotencyKeys: number;
}

const PRUNE_BATCH_SIZE = 1000;
const logger = new Logger('DailyJob');

/**
 * El proceso diario (requerimientos-backend.md §3.7): genera las recurrentes
 * que ya tocaban y limpia las llaves de idempotencia expiradas.
 */
export async function runDailyJob(
  app: INestApplicationContext,
): Promise<DailyJobSummary> {
  const recurringTransactions = await app
    .get(RecurringTransactionsService)
    .generateAllDue();
  const store = app.get(TypeOrmIdempotencyStore);
  let prunedIdempotencyKeys = 0;
  for (;;) {
    const pruned = await store.prune(PRUNE_BATCH_SIZE);
    prunedIdempotencyKeys += pruned;
    if (pruned < PRUNE_BATCH_SIZE) {
      break;
    }
  }
  const summary = { recurringTransactions, prunedIdempotencyKeys };
  logger.log(JSON.stringify(summary));
  return summary;
}

let context: Promise<INestApplicationContext> | undefined;

/** Para la Lambda que invoca EventBridge Scheduler una vez al día; el contexto se reutiliza entre invocaciones. */
export async function handler(): Promise<DailyJobSummary> {
  context ??= NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  return runDailyJob(await context);
}

// `npm run job:daily` después de `npm run build`.
if (require.main === module) {
  void (async () => {
    const app = await NestFactory.createApplicationContext(AppModule);
    try {
      const summary = await runDailyJob(app);
      process.exitCode = summary.recurringTransactions.failures > 0 ? 1 : 0;
    } finally {
      await app.close();
    }
  })();
}
