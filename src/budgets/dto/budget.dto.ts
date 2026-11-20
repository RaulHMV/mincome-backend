import { z } from 'zod';
import {
  amountSchema,
  categoryIdSchema,
  isoMonthSchema,
} from '../../common/validation/schemas';

export const budgetMonthQuerySchema = z.object({
  /** Por defecto, el mes actual en la zona del usuario. */
  month: isoMonthSchema.optional(),
});

const budgetChangeSchema = z.object({
  categoryId: categoryIdSchema,
  /** Obligatorio al crear. */
  limit: amountSchema.optional(),
  alertThreshold: z
    .number({ error: 'El umbral debe ser un número entero' })
    .int({ error: 'El umbral debe ser un número entero' })
    .min(1, { error: 'El umbral mínimo es 1%' })
    .max(99, { error: 'El umbral máximo es 99%' })
    .optional(),
  /** false quita el presupuesto desde ese mes. */
  isActive: z.boolean({ error: 'Usa true o false' }).optional(),
});

/** "Ajustar límites": crea o actualiza por categoría; no toca las que no vienen. */
export const putBudgetsSchema = z
  .array(budgetChangeSchema, { error: 'Manda una lista de presupuestos' })
  .min(1, { error: 'Manda al menos un presupuesto' })
  .max(100, { error: 'Máximo 100 presupuestos' })
  .superRefine((changes, ctx) => {
    const seen = new Set<number>();
    changes.forEach((change, index) => {
      if (seen.has(change.categoryId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'categoryId'],
          message: 'La categoría está repetida',
        });
      }
      seen.add(change.categoryId);
    });
  });

export type BudgetMonthQuery = z.infer<typeof budgetMonthQuerySchema>;
export type PutBudgetsDto = z.infer<typeof putBudgetsSchema>;
