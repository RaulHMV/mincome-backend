import { z } from 'zod';
import {
  FlowSubtype,
  FlowType,
  Frequency,
  PaymentMethod,
} from '../../common/enums';
import {
  amountSchema,
  booleanQuerySchema,
  categoryIdSchema,
  isoDateSchema,
  requiredText,
  uuidSchema,
} from '../../common/validation/schemas';

const dayOfMonthSchema = z
  .number({ error: 'Elige un día del 1 al 31' })
  .int({ error: 'Elige un día del 1 al 31' })
  .min(1, { error: 'Elige un día del 1 al 31' })
  .max(31, { error: 'Elige un día del 1 al 31' });

export const listRecurringTransactionsQuerySchema = z.object({
  isActive: booleanQuerySchema.optional(),
});

export const createRecurringTransactionSchema = z
  .object({
    type: z.enum(FlowType, { error: 'Usa income o expense' }),
    /** income: recurring; expense: fixed (decisión D3). */
    subtype: z.enum(FlowSubtype, { error: 'Usa recurring o fixed' }),
    categoryId: categoryIdSchema,
    amount: amountSchema,
    concept: requiredText(120),
    paymentMethod: z.enum(PaymentMethod, {
      error: 'Usa cash, transfer o card',
    }),
    cardId: uuidSchema.nullable().default(null),
    accountId: uuidSchema.nullable().default(null),
    frequency: z.enum(Frequency, {
      error: 'Usa weekly, semimonthly, monthly o yearly',
    }),
    /** Solo en monthly. */
    dayOfMonth: dayOfMonthSchema.nullable().default(null),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().default(null),
  })
  .superRefine((template, ctx) => {
    if (
      template.frequency === Frequency.MONTHLY &&
      template.dayOfMonth === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayOfMonth'],
        message: 'Obligatorio en monthly',
      });
    }
    if (
      template.frequency !== Frequency.MONTHLY &&
      template.dayOfMonth !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayOfMonth'],
        message: 'Solo aplica en monthly',
      });
    }
    if (template.endDate !== null && template.endDate < template.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Debe ser igual o posterior al inicio',
      });
    }
  });

/**
 * El tipo, la frecuencia y el inicio no cambian: definen las ocurrencias que
 * ya se generaron. Para otra regla, termina esta y crea otra.
 */
export const updateRecurringTransactionSchema = z.strictObject({
  subtype: z.enum(FlowSubtype, { error: 'Usa recurring o fixed' }).optional(),
  categoryId: categoryIdSchema.optional(),
  amount: amountSchema.optional(),
  concept: requiredText(120).optional(),
  paymentMethod: z
    .enum(PaymentMethod, { error: 'Usa cash, transfer o card' })
    .optional(),
  cardId: uuidSchema.nullable().optional(),
  accountId: uuidSchema.nullable().optional(),
  dayOfMonth: dayOfMonthSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
  isActive: z.boolean({ error: 'Usa true o false' }).optional(),
});

export type ListRecurringTransactionsQuery = z.infer<
  typeof listRecurringTransactionsQuerySchema
>;
export type CreateRecurringTransactionDto = z.infer<
  typeof createRecurringTransactionSchema
>;
export type UpdateRecurringTransactionDto = z.infer<
  typeof updateRecurringTransactionSchema
>;
