import type { StandardSchemaValidationPipeOptions } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../errors/api-error';

// Mensajes de Zod en español para las reglas que no traen uno propio.
z.config(z.locales.es());

type Issue = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0][number];

function fieldOf(issue: Issue): string | null {
  const path = (issue.path ?? []).map((segment) =>
    typeof segment === 'object' ? String(segment.key) : String(segment),
  );
  return path.length > 0 ? path.join('.') : null;
}

/**
 * Los errores de Zod como `422 validation_error` con un mensaje por campo
 * (contrato §1, "Errores"). Si un campo tiene varios errores, va el primero.
 */
export function validationExceptionFactory(
  issues: readonly Issue[],
): ValidationError {
  const fields: Record<string, string> = {};
  let message: string | undefined;
  for (const issue of issues) {
    const field = fieldOf(issue);
    if (field === null) {
      message ??= issue.message;
    } else {
      fields[field] ??= issue.message;
    }
  }
  return new ValidationError(
    Object.keys(fields).length > 0 ? fields : null,
    message ?? 'Revisa los campos marcados.',
  );
}
