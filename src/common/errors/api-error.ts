import { HttpException, HttpStatus } from '@nestjs/common';

// Contrato §1, "Errores": siempre la misma forma, con errores por campo para
// que los formularios los marquen. El front decide con `code`; `message` va en
// español y se puede mostrar tal cual.

export type ApiErrorCode =
  | 'unauthenticated'
  | 'premium_required'
  | 'not_editable'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'insufficient_funds'
  | 'validation_error'
  | 'idempotency_key_in_use'
  | 'idempotency_key_reused'
  | 'quota_exceeded'
  | 'internal_error';

export type FieldErrors = Record<string, string>;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields: FieldErrors | null;
  };
}

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: ApiErrorCode,
    message: string,
    fields: FieldErrors | null = null,
  ) {
    super({ error: { code, message, fields } } satisfies ApiErrorBody, status);
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(
    message = 'Tu sesión no es válida o ya expiró. Inicia sesión de nuevo.',
  ) {
    super(HttpStatus.UNAUTHORIZED, 'unauthenticated', message);
  }
}

export class PremiumRequiredError extends ApiError {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      'premium_required',
      'Piggy está disponible solo en el plan premium.',
    );
  }
}

export class NotEditableError extends ApiError {
  constructor(message: string) {
    super(HttpStatus.FORBIDDEN, 'not_editable', message);
  }
}

/** Existe o no, si es de otro usuario la respuesta es la misma (requerimientos-backend.md §5). */
export class NotFoundError extends ApiError {
  constructor(message = 'No encontramos lo que buscas.') {
    super(HttpStatus.NOT_FOUND, 'not_found', message);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, fields: FieldErrors | null = null) {
    super(HttpStatus.CONFLICT, 'conflict', message, fields);
  }
}

export class InsufficientFundsError extends ApiError {
  constructor(message: string, fields: FieldErrors | null = null) {
    super(HttpStatus.CONFLICT, 'insufficient_funds', message, fields);
  }
}

export class ValidationError extends ApiError {
  constructor(
    fields: FieldErrors | null,
    message = 'Revisa los campos marcados.',
  ) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, 'validation_error', message, fields);
  }

  static forField(field: string, message: string): ValidationError {
    return new ValidationError({ [field]: message });
  }
}

export class QuotaExceededError extends ApiError {
  constructor() {
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      'quota_exceeded',
      'Ya usaste todas las consultas o los tokens de Piggy de este mes.',
    );
  }
}
