import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../common/errors/api-error';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { currentApiGatewayAuthorizer } from '../lambda/api-gateway-event';
import { roleKeyOfAssumedRoleArn, roleKeyOfRoleArn } from './iam-arn';

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Rutas /internal/* de mincome-ai-wrapper (contrato §3.8), junto con @Public().
 *
 * - Modo `api-gateway` (Lambda): la ruta tiene autorización IAM en API
 *   Gateway y aquí se revisa que quien firmó sea uno de
 *   INTERNAL_CALLER_ROLE_ARNS (el rol de la Lambda del wrapper).
 * - Modo `jwt` (local y pruebas): header `x-internal-api-key` igual a
 *   INTERNAL_API_KEY.
 *
 * Sin configuración, quedan cerradas.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly authMode: AppConfig['authMode'];
  private readonly allowedRoles: Set<string>;
  private readonly expectedKeyDigest: Buffer | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.authMode = config.authMode;
    this.allowedRoles = new Set(
      config.internalCallerRoleArns
        .map(roleKeyOfRoleArn)
        .filter((key): key is string => key !== null),
    );
    this.expectedKeyDigest = config.internalApiKey
      ? digest(config.internalApiKey)
      : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const allowed =
      this.authMode === 'api-gateway'
        ? this.isAllowedIamCaller()
        : this.hasInternalKey(context.switchToHttp().getRequest<Request>());
    if (!allowed) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Esta ruta es solo para servicios internos.',
      );
    }
    return true;
  }

  private isAllowedIamCaller(): boolean {
    const callerArn = currentApiGatewayAuthorizer()?.iam?.userArn;
    const roleKey = callerArn ? roleKeyOfAssumedRoleArn(callerArn) : null;
    return roleKey !== null && this.allowedRoles.has(roleKey);
  }

  private hasInternalKey(request: Request): boolean {
    const provided = request.header(INTERNAL_API_KEY_HEADER);
    return (
      this.expectedKeyDigest !== null &&
      provided !== undefined &&
      timingSafeEqual(digest(provided), this.expectedKeyDigest)
    );
  }
}
