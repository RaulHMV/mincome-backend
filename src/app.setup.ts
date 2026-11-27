import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { IDEMPOTENCY_KEY_HEADER } from './idempotency/moves-money.decorator';

export const API_PREFIX = 'api/v1';

/** Lo que main.ts y las pruebas e2e configuran igual sobre la app. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: config.corsOrigins,
    allowedHeaders: ['Authorization', 'Content-Type', IDEMPOTENCY_KEY_HEADER],
    exposedHeaders: ['Idempotent-Replayed', 'Retry-After'],
  });
  (app.getHttpAdapter().getInstance() as Express).disable('x-powered-by');
}
