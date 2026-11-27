import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  APIGatewayEventRequestContextIAMAuthorizer,
  APIGatewayEventRequestContextJWTAuthorizer,
  APIGatewayEventRequestContextV2WithAuthorizer,
  APIGatewayProxyEventV2WithRequestContext,
} from 'aws-lambda';

/**
 * Lo que API Gateway HTTP API ya validó: los claims del JWT de Cognito
 * (autorizador JWT) o quién firmó con IAM (rutas /internal/*).
 */
export type ApiGatewayAuthorizer = Partial<
  APIGatewayEventRequestContextJWTAuthorizer &
    APIGatewayEventRequestContextIAMAuthorizer
>;

/** Evento de HTTP API con el formato de payload 2.0. */
export type ApiGatewayHttpEvent = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2WithAuthorizer<
    ApiGatewayAuthorizer | undefined
  >
>;

export function isApiGatewayHttpEvent(
  event: unknown,
): event is ApiGatewayHttpEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as Partial<ApiGatewayHttpEvent>;
  return (
    candidate.version === '2.0' &&
    typeof candidate.rawPath === 'string' &&
    typeof candidate.requestContext?.http?.method === 'string'
  );
}

// Uno por invocación, no una variable global: si Lambda llega a atender
// varias peticiones a la vez en el mismo entorno, cada una ve su evento.
const currentEvent = new AsyncLocalStorage<ApiGatewayHttpEvent>();

export function runWithApiGatewayEvent<T>(
  event: ApiGatewayHttpEvent,
  callback: () => T,
): T {
  return currentEvent.run(event, callback);
}

/** El autorizador de la petición en curso; undefined fuera de Lambda o en una ruta sin autorizador. */
export function currentApiGatewayAuthorizer():
  ApiGatewayAuthorizer | undefined {
  return currentEvent.getStore()?.requestContext.authorizer;
}
