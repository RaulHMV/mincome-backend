import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import type { ApiErrorBody, ApiErrorCode } from './api-error';

const MESSAGES_BY_STATUS: Partial<Record<number, [ApiErrorCode, string]>> = {
  // Sale como 422 (ver toResponse): el contrato usa 422 para un body inválido.
  [HttpStatus.BAD_REQUEST]: [
    'validation_error',
    'El cuerpo de la petición no es un JSON válido.',
  ],
  [HttpStatus.UNAUTHORIZED]: [
    'unauthenticated',
    'Tu sesión no es válida o ya expiró. Inicia sesión de nuevo.',
  ],
  [HttpStatus.FORBIDDEN]: ['forbidden', 'No tienes permiso para hacer esto.'],
  [HttpStatus.NOT_FOUND]: ['not_found', 'No encontramos lo que buscas.'],
  [HttpStatus.METHOD_NOT_ALLOWED]: [
    'not_found',
    'No encontramos lo que buscas.',
  ],
  [HttpStatus.CONFLICT]: [
    'conflict',
    'La operación choca con el estado actual.',
  ],
  [HttpStatus.PAYLOAD_TOO_LARGE]: [
    'validation_error',
    'La petición es demasiado grande.',
  ],
  [HttpStatus.UNPROCESSABLE_ENTITY]: [
    'validation_error',
    'Revisa los campos marcados.',
  ],
};

// Rechazos de @nestjs/idempotency, que llegan con su propio `code`.
const IDEMPOTENCY_ERRORS: Record<string, [HttpStatus, ApiErrorCode, string]> = {
  IDEMPOTENCY_KEY_REQUIRED: [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_error',
    'Falta el encabezado Idempotency-Key.',
  ],
  IDEMPOTENCY_KEY_INVALID: [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_error',
    'El encabezado Idempotency-Key debe tener de 1 a 255 caracteres ASCII imprimibles.',
  ],
  IDEMPOTENCY_KEY_IN_USE: [
    HttpStatus.CONFLICT,
    'idempotency_key_in_use',
    'Todavía estamos procesando una petición con esta Idempotency-Key.',
  ],
  IDEMPOTENCY_KEY_REUSED: [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'idempotency_key_reused',
    'Esta Idempotency-Key ya se usó en otra petición.',
  ],
};

// Códigos de PostgreSQL que solo aparecen si una validación del back se
// adelantó a la BD (por ejemplo, dos peticiones simultáneas con el mismo nombre).
const POSTGRES_ERRORS: Record<string, [HttpStatus, ApiErrorCode, string]> = {
  '23505': [
    HttpStatus.CONFLICT,
    'conflict',
    'Ya existe un registro con esos datos.',
  ],
  '23503': [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_error',
    'Uno de los registros relacionados no existe.',
  ],
  '23514': [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_error',
    'Los datos no cumplen las reglas del registro.',
  ],
};

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof error.code === 'string'
  );
}

function bodyOf(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message, fields: null } };
}

/**
 * Convierte toda excepción en la forma de error del contrato. Las respuestas
 * que repite @nestjs/idempotency ya traen esa forma y pasan tal cual.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ApiErrorBody] {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isApiErrorBody(body)) {
        return [status, body];
      }
      const idempotencyError =
        typeof body === 'object' && body !== null && 'code' in body
          ? IDEMPOTENCY_ERRORS[String(body.code)]
          : undefined;
      if (idempotencyError) {
        const [mappedStatus, code, message] = idempotencyError;
        return [mappedStatus, bodyOf(code, message)];
      }
      const [code, message] = MESSAGES_BY_STATUS[status] ?? [
        status >= 500 ? 'internal_error' : 'validation_error',
        status >= 500
          ? 'Ocurrió un error inesperado.'
          : 'La petición no es válida.',
      ];
      if (status >= 500) {
        this.logger.error(exception.message, exception.stack);
      }
      // 400 viene de Express o de un pipe de Nest, casi siempre un JSON mal
      // formado: para el front es un body inválido, igual que con Zod.
      return [
        status === HttpStatus.BAD_REQUEST
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : status,
        bodyOf(code, message),
      ];
    }

    if (exception instanceof QueryFailedError) {
      const driverCode = (
        exception.driverError as { code?: string } | undefined
      )?.code;
      const postgresError = driverCode
        ? POSTGRES_ERRORS[driverCode]
        : undefined;
      if (postgresError) {
        const [status, code, message] = postgresError;
        return [status, bodyOf(code, message)];
      }
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      bodyOf('internal_error', 'Ocurrió un error inesperado.'),
    ];
  }
}
