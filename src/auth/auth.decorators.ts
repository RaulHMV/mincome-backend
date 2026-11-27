import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';

/** Rutas que no llevan token de Cognito: la de salud y las internas, que tienen su propio guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error(
        'CurrentUser used on a route without an authenticated user',
      );
    }
    return request.user;
  },
);
