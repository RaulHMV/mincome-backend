import { z } from 'zod';
import { CardType } from '../../common/enums';
import {
  amountSchema,
  balanceSchema,
  booleanQuerySchema,
  hexColorSchema,
  isoDateSchema,
  optionalText,
  requiredText,
  uuidSchema,
} from '../../common/validation/schemas';
import { looksLikeCardNumber } from '../card.calculator';

// RNF3: los cuerpos de tarjetas son estrictos. Un campo de más (cvv, nip,
// numero, titular) se rechaza en lugar de ignorarse.

const aliasSchema = requiredText(50).refine(
  (alias) => !looksLikeCardNumber(alias),
  {
    error: 'No escribas el número de la tarjeta en el alias',
  },
);
const last4Schema = z
  .string({ error: 'Escribe los últimos 4 dígitos' })
  .regex(/^\d{4}$/, { error: 'Solo los últimos 4 dígitos' });
const daySchema = z
  .number({ error: 'Elige un día del 1 al 31' })
  .int({ error: 'Elige un día del 1 al 31' })
  .min(1, { error: 'Elige un día del 1 al 31' })
  .max(31, { error: 'Elige un día del 1 al 31' });

const creditCardSchema = z
  .strictObject({
    type: z.literal(CardType.CREDIT),
    alias: aliasSchema,
    bank: requiredText(50),
    last4: last4Schema,
    colorHex: hexColorSchema.nullable().default(null),
    creditLimit: amountSchema,
    cutoffDay: daySchema,
    dueDay: daySchema,
    /** "Saldo utilizado" de hoy. */
    initialDebt: balanceSchema.default(0),
  })
  .refine((card) => card.cutoffDay !== card.dueDay, {
    path: ['dueDay'],
    error: 'Debe ser distinto al día de corte',
  });

const debitCardSchema = z
  .strictObject({
    type: z.literal(CardType.DEBIT),
    alias: aliasSchema,
    bank: requiredText(50),
    last4: last4Schema,
    colorHex: hexColorSchema.nullable().default(null),
    /** La cuenta de débito a la que pertenece; null crea una cuenta nueva. */
    accountId: uuidSchema.nullable().default(null),
    /** Solo si se crea cuenta nueva. */
    initialBalance: balanceSchema.optional(),
  })
  .refine(
    (card) => card.accountId === null || card.initialBalance === undefined,
    {
      path: ['initialBalance'],
      error: 'Solo va al crear una cuenta nueva',
    },
  );

export const createCardSchema = z.discriminatedUnion(
  'type',
  [creditCardSchema, debitCardSchema],
  {
    error: 'Usa credit o debit',
  },
);

/** `type` no se puede cambiar. */
export const updateCardSchema = z.strictObject({
  alias: aliasSchema.optional(),
  bank: requiredText(50).optional(),
  last4: last4Schema.optional(),
  colorHex: hexColorSchema.nullable().optional(),
  creditLimit: amountSchema.optional(),
  cutoffDay: daySchema.optional(),
  dueDay: daySchema.optional(),
  isActive: z.boolean({ error: 'Usa true o false' }).optional(),
});

export const listCardsQuerySchema = z.object({
  type: z.enum(CardType, { error: 'Usa credit o debit' }).optional(),
  isActive: booleanQuerySchema.optional(),
});

/** "Pagar tarjeta": es un traspaso, no un gasto (requerimientos-backend.md §2.2). */
export const payCardSchema = z.object({
  amount: amountSchema,
  sourceAccountId: uuidSchema,
  /** Por defecto, hoy en la zona del usuario. */
  date: isoDateSchema.optional(),
  note: optionalText(200).optional().default(null),
});

export type CreateCardDto = z.infer<typeof createCardSchema>;
export type UpdateCardDto = z.infer<typeof updateCardSchema>;
export type ListCardsQuery = z.infer<typeof listCardsQuerySchema>;
export type PayCardDto = z.infer<typeof payCardSchema>;
