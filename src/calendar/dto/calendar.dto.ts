import { z } from 'zod';
import { isoDateSchema, isoMonthSchema } from '../../common/validation/schemas';

export const calendarQuerySchema = z.object({
  /** Por defecto, el mes actual en la zona del usuario. */
  month: isoMonthSchema.optional(),
});

/** NUMERIC(12,2), como los montos que se guardan. */
const MAX_AMOUNT = 9_999_999_999.99;

const simulatorAmountSchema = z.coerce
  .number({ error: 'Ingresa un monto numérico válido' })
  .min(0, { error: 'No puede ser negativo' })
  .max(MAX_AMOUNT, { error: 'El monto excede el límite permitido' })
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    error: 'Máximo 2 decimales',
  })
  .default(0);

/** Contrato §3.6: los campos del simulador del Calendario. */
export const balanceProjectionQuerySchema = z.object({
  date: isoDateSchema,
  extraIncome: simulatorAmountSchema,
  extraExpense: simulatorAmountSchema,
  dailySaving: simulatorAmountSchema,
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type BalanceProjectionQuery = z.infer<
  typeof balanceProjectionQuerySchema
>;
