import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '../common/errors/api-error';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest, TokenIdentity } from './auth-user';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { TOKEN_VERIFIER, type TokenVerifier } from './cognito-token.verifier';

/** Global: toda ruta pide `Authorization: Bearer <token de Cognito>`, salvo las @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer (\S+)$/i.exec(
      request.header('authorization') ?? '',
    )?.[1];
    if (!token) {
      throw new UnauthenticatedError('Falta el token de sesión.');
    }

    let identity: TokenIdentity;
    try {
      identity = await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthenticatedError();
    }
    request.user = await this.usersService.resolve(identity);
    return true;
  }
}
