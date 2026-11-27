import { z } from 'zod';
import { PocketMovementType } from '../../common/enums';
import {
  amountSchema,
  balanceSchema,
  booleanQuerySchema,
  hexColorSchema,
  isoDateSchema,
  optionalText,
  requiredText,
  targetAmountSchema,
  uuidSchema,
} from '../../common/validation/schemas';
import { POCKET_ICONS } from '../pocket.calculator';

const iconSchema = z.enum(POCKET_ICONS, {
  error: `Usa uno de: ${POCKET_ICONS.join(', ')}`,
});

export const listPocketsQuerySchema = z.object({
  isActive: booleanQuerySchema.optional(),
});

/** "Nueva meta de ahorro". La meta es obligatoria mientras la UI la pida (decisión D17). */
export const createPocketSchema = z
  .object({
    name: requiredText(60),
    targetAmount: targetAmountSchema,
    targetDate: isoDateSchema.nullable().default(null),
    icon: iconSchema.nullable().default(null),
    colorHex: hexColorSchema.nullable().default(null),
    /** "Asignación inicial"; 0 si no hay. */
    initialAmount: balanceSchema.default(0),
    /** De dónde sale la asignación inicial (decisión D15). */
    sourceAccountId: uuidSchema.nullable().default(null),
  })
  .superRefine((pocket, ctx) => {
    if (pocket.initialAmount > pocket.targetAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['initialAmount'],
        message: 'No puede ser mayor a la meta',
      });
    }
    if (pocket.initialAmount > 0 && pocket.sourceAccountId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceAccountId'],
        message: 'Elige de qué cuenta sale la asignación inicial',
      });
    }
  });

export const updatePocketSchema = z.object({
  name: requiredText(60).optional(),
  targetAmount: targetAmountSchema.optional(),
  targetDate: isoDateSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
  colorHex: hexColorSchema.nullable().optional(),
});

/** "Liberar y completar meta". */
export const releasePocketSchema = z.object({
  destinationAccountId: uuidSchema,
});

/** "+ Abonar" o "− Retirar". */
export const createPocketMovementSchema = z.object({
  type: z.enum(PocketMovementType, { error: 'Usa deposit o withdrawal' }),
  amount: amountSchema,
  /** Por defecto, hoy en la zona del usuario. */
  date: isoDateSchema.optional(),
  accountId: uuidSchema,
  note: optionalText(200).optional().default(null),
});

export type ListPocketsQuery = z.infer<typeof listPocketsQuerySchema>;
export type CreatePocketDto = z.infer<typeof createPocketSchema>;
export type UpdatePocketDto = z.infer<typeof updatePocketSchema>;
export type ReleasePocketDto = z.infer<typeof releasePocketSchema>;
export type CreatePocketMovementDto = z.infer<
  typeof createPocketMovementSchema
>;
