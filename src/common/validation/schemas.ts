import { z } from 'zod';
import { isIsoDate, isIsoMonth, isValidTimeZone } from '../dates';

// Validadores base, con las mismas reglas que los schemas de Zod del front
// (src/schemas/finance.schema.ts de mincome-frontend).

/** NUMERIC(12,2): el tope de monto, ingresos, gastos, traspasos y movimientos. */
const MAX_AMOUNT = 9_999_999_999.99;
/** NUMERIC(14,2): saldos y metas. */
const MAX_BALANCE = 999_999_999_999.99;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tolera el ruido de punto flotante (19.99 * 100 = 1998.9999999999998). */
function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

function money(max: number, { allowZero }: { allowZero: boolean }) {
  const base = z.number({ error: 'Ingresa un monto numérico válido' });
  return (
    allowZero
      ? base.min(0, { error: 'No puede ser negativo' })
      : base.positive({ error: 'Debe ser mayor a 0' })
  )
    .max(max, { error: 'El monto excede el límite permitido' })
    .refine(hasAtMostTwoDecimals, { error: 'Máximo 2 decimales' });
}

export const amountSchema = money(MAX_AMOUNT, { allowZero: false });
export const balanceSchema = money(MAX_BALANCE, { allowZero: true });
export const targetAmountSchema = money(MAX_BALANCE, { allowZero: false });

export const isoDateSchema = z
  .string({ error: 'La fecha es obligatoria' })
  .refine(isIsoDate, {
    error: 'Usa una fecha válida con el formato AAAA-MM-DD',
  });

export const isoMonthSchema = z
  .string()
  .refine(isIsoMonth, { error: 'Usa un mes válido con el formato AAAA-MM' });

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: 'Usa una hora válida con el formato HH:MM',
});

export const uuidSchema = z
  .string({ error: 'El identificador es obligatorio' })
  .regex(UUID_PATTERN, { error: 'Identificador inválido' })
  .transform((value) => value.toLowerCase());

export const categoryIdSchema = z
  .number({ error: 'La categoría es obligatoria' })
  .int({ error: 'Identificador inválido' })
  .positive({ error: 'Identificador inválido' })
  .max(2_147_483_647, { error: 'Identificador inválido' });

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'Usa un color hexadecimal (#RRGGBB)' });

export const timeZoneSchema = z.string().refine(isValidTimeZone, {
  error: 'Usa una zona horaria IANA, como America/Mexico_City',
});

export function requiredText(max: number) {
  return z
    .string({ error: 'Es obligatorio' })
    .trim()
    .min(1, { error: 'Es obligatorio' })
    .max(max, { error: `Máximo ${max} caracteres` });
}

/** Texto opcional: vacío o solo espacios cuenta como null. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));
}

/** Query params booleanos: solo 'true' o 'false'. */
export const booleanQuerySchema = z
  .enum(['true', 'false'], { error: "Usa 'true' o 'false'" })
  .transform((value) => value === 'true');

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'La página debe ser un número' })
    .int({ error: 'La página debe ser un número entero' })
    .min(1, { error: 'La página empieza en 1' })
    .default(1),
  pageSize: z.coerce
    .number({ error: 'El tamaño de página debe ser un número' })
    .int({ error: 'El tamaño de página debe ser un número entero' })
    .min(1, { error: 'Mínimo 1 por página' })
    .max(100, { error: 'Máximo 100 por página' })
    .default(20),
});

/** ?dryRun=true valida y calcula sin guardar (contrato §1, "Escrituras"). */
export const dryRunQuerySchema = z.object({
  dryRun: booleanQuerySchema.optional().default(false),
});
