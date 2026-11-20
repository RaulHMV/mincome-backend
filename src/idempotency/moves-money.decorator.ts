import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Idempotent } from '@nestjs/idempotency';
import type { Request } from 'express';
import { ValidationError } from '../common/errors/api-error';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

function isDryRun(request: Request): boolean {
  return request.query.dryRun === 'true';
}

function idempotencyKeyOf(request: Request): string | undefined {
  return request.header(IDEMPOTENCY_KEY_HEADER);
}

/**
 * Un POST que mueve dinero no corre sin Idempotency-Key, salvo con
 * ?dryRun=true, que no guarda nada. Va como guard para rechazar antes de
 * validar el cuerpo, con la forma de error del contrato.
 */
@Injectable()
export class IdempotencyKeyRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isDryRun(request) && !idempotencyKeyOf(request)) {
      throw ValidationError.forField(
        IDEMPOTENCY_KEY_HEADER,
        'Manda un identificador único por intento (por ejemplo, un UUID) y repítelo en los reintentos.',
      );
    }
    return true;
  }
}

/**
 * Para los POST que mueven dinero (transacciones, movimientos de apartado y
 * pagos de tarjeta): la misma Idempotency-Key corre el handler una vez y los
 * reintentos reciben la respuesta guardada (contrato §1, "Escrituras").
 * Con ?dryRun=true la llave se ignora, para que un borrador no la gaste.
 */
export function MovesMoney(): MethodDecorator {
  return applyDecorators(
    UseGuards(IdempotencyKeyRequiredGuard),
    Idempotent({
      keyFrom: {
        http: (context) => {
          const request = context.switchToHttp().getRequest<Request>();
          return isDryRun(request) ? undefined : idempotencyKeyOf(request);
        },
      },
    }),
  );
}
