import { Logger, type INestApplicationContext } from '@nestjs/common';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { UsersService } from '../users/users.service';

const logger = new Logger('CognitoPostConfirmation');

export function isPostConfirmationEvent(
  event: unknown,
): event is PostConfirmationTriggerEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as Partial<PostConfirmationTriggerEvent>;
  return (
    typeof candidate.userPoolId === 'string' &&
    typeof candidate.triggerSource === 'string' &&
    candidate.triggerSource.startsWith('PostConfirmation_')
  );
}

function attribute(
  attributes: Record<string, string | undefined>,
  name: string,
): string | null {
  const value = attributes[name]?.trim();
  return value ? value : null;
}

/**
 * Trigger *Post confirmation* de Cognito (requerimientos-backend.md §5): crea
 * la fila en `usuarios` al confirmar el correo. Regresa el evento, como pide
 * Cognito. Si algo falla, no bloquea la confirmación: GET /me crea al usuario
 * después con el ID token.
 */
export async function handlePostConfirmation(
  app: INestApplicationContext,
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }
  const { cognito } = app.get<AppConfig>(APP_CONFIG);
  if (event.userPoolId !== cognito.userPoolId) {
    logger.warn(
      `Ignoring a trigger from another user pool: ${event.userPoolId}`,
    );
    return event;
  }

  const attributes = event.request.userAttributes;
  const cognitoSub = attribute(attributes, 'sub');
  const email = attribute(attributes, 'email');
  const name = attribute(attributes, 'name');
  if (!cognitoSub || !email || !name) {
    logger.warn(
      'Sign-up without sub, email or name; GET /me will create the user',
    );
    return event;
  }

  try {
    await app.get(UsersService).provision({
      cognitoSub,
      email,
      name,
      termsVersion: attribute(attributes, 'custom:terminos_version'),
    });
  } catch (error) {
    // Sin el correo: es dato personal.
    logger.error(
      `Could not create the user ${cognitoSub}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
  return event;
}
