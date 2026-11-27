import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '../common/errors/api-error';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { currentApiGatewayAuthorizer } from '../lambda/api-gateway-event';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest, TokenIdentity } from './auth-user';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { assertClaimsFor, identityFromClaims } from './cognito-claims';
import { TOKEN_VERIFIER, type TokenVerifier } from './cognito-token.verifier';

/**
 * Global: toda ruta pide el token de Cognito, salvo las @Public().
 *
 * - Modo `api-gateway` (Lambda): el autorizador JWT de API Gateway ya verificó
 *   la firma; se leen sus claims del evento (requerimientos-backend.md §5).
 * - Modo `jwt` (local y pruebas): se verifica `Authorization: Bearer <token>`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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
    const identity =
      this.config.authMode === 'api-gateway'
        ? this.identityFromApiGateway()
        : await this.identityFromBearerToken(request);
    request.user = await this.usersService.resolve(identity);
    return true;
  }

  private identityFromApiGateway(): TokenIdentity {
    const claims = currentApiGatewayAuthorizer()?.jwt?.claims;
    if (!claims) {
      // La ruta llegó sin autorizador JWT: se rechaza en vez de confiar.
      throw new UnauthenticatedError('Falta el token de sesión.');
    }
    try {
      assertClaimsFor(this.config.cognito, claims, Date.now() / 1000);
      return identityFromClaims(claims);
    } catch {
      throw new UnauthenticatedError();
    }
  }

  private async identityFromBearerToken(
    request: AuthenticatedRequest,
  ): Promise<TokenIdentity> {
    const token = /^Bearer (\S+)$/i.exec(
      request.header('authorization') ?? '',
    )?.[1];
    if (!token) {
      throw new UnauthenticatedError('Falta el token de sesión.');
    }
    try {
      return await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthenticatedError();
    }
  }
}
