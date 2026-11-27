import configureServerlessExpress from '@codegenie/serverless-express';
import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Context } from 'aws-lambda';
import type { RequestListener } from 'node:http';
import { AppModule, ObserveInstrument } from './app.module';
import { configureApp } from './app.setup';
import {
  isApiGatewayHttpEvent,
  runWithApiGatewayEvent,
} from './lambda/api-gateway-event';
import {
  handlePostConfirmation,
  isPostConfirmationEvent,
} from './lambda/cognito-post-confirmation';
import { isJobEvent, runJob } from './lambda/jobs';

/**
 * La Lambda de mincome-backend (handler `lambda.handler` del paquete de
 * dist-lambda; terraform/backend). Atiende:
 * - API Gateway HTTP API (payload 2.0): la API REST completa.
 * - El trigger Post confirmation de Cognito.
 * - `{"job": "daily"}` de EventBridge Scheduler, y `{"job": "migrate"}` y
 *   `{"job": "bootstrap"}` del despliegue (src/lambda/jobs.ts).
 *
 * La app de Nest se arma una vez por instancia, en el arranque en frío, y se
 * reutiliza en las invocaciones siguientes junto con su pool de conexiones.
 */
let app: Promise<INestApplication> | undefined;
let httpHandler: ReturnType<typeof configureServerlessExpress> | undefined;

async function createApp(): Promise<INestApplication> {
  const nestApp = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Una línea JSON por log, que CloudWatch Logs Insights puede filtrar.
    logger: new ConsoleLogger({ json: true }),
  });
  configureApp(nestApp);
  await nestApp.init();
  return nestApp;
}

function getApp(): Promise<INestApplication> {
  app ??= createApp().catch((error: unknown) => {
    // Que la siguiente invocación lo vuelva a intentar.
    app = undefined;
    throw error;
  });
  return app;
}

export async function handler(
  event: unknown,
  context: Context,
): Promise<unknown> {
  if (isApiGatewayHttpEvent(event)) {
    const nestApp = await getApp();
    const handle = (httpHandler ??= configureServerlessExpress({
      // La app de Express.
      app: nestApp.getHttpAdapter().getInstance() as RequestListener,
    }));
    return runWithApiGatewayEvent(event, () =>
      handle(event, context, () => undefined),
    );
  }
  if (isPostConfirmationEvent(event)) {
    return handlePostConfirmation(await getApp(), event);
  }
  if (isJobEvent(event)) {
    return runJob(await getApp(), event);
  }
  throw new Error('Unsupported Lambda event');
}

/** Cierra la app de esta instancia y su pool; lo usan las pruebas. */
export async function closeApp(): Promise<void> {
  const current = app;
  app = undefined;
  httpHandler = undefined;
  if (current) {
    await (await current).close();
  }
}
