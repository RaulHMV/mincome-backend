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

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Rutas /internal/* del AI wrapper (contrato §3.8). En AWS las protege la
 * autorización IAM de API Gateway; esta llave compartida las mantiene
 * cerradas si la app corre en otro lado o el autorizador falta. Sin
 * INTERNAL_API_KEY, quedan cerradas.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly expectedDigest: Buffer | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.expectedDigest = config.internalApiKey
      ? digest(config.internalApiKey)
      : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(INTERNAL_API_KEY_HEADER);
    if (
      !this.expectedDigest ||
      !provided ||
      !timingSafeEqual(digest(provided), this.expectedDigest)
    ) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Esta ruta es solo para servicios internos.',
      );
    }
    return true;
  }
}
