import { z } from 'zod';
import { FlowSubtype, FlowType, PaymentMethod } from '../../common/enums';
import {
  amountSchema,
  categoryIdSchema,
  isoDateSchema,
  optionalText,
  requiredText,
  timeSchema,
  uuidSchema,
} from '../../common/validation/schemas';

const transactionFields = {
  type: z.enum(FlowType, { error: 'Usa income o expense' }),
  subtype: z.enum(FlowSubtype, { error: 'Usa recurring, variable o fixed' }),
  categoryId: categoryIdSchema,
  amount: amountSchema,
  date: isoDateSchema,
  time: timeSchema.nullable(),
  /** Obligatorio; en gastos, si el usuario no escribe nada, el front manda el nombre de la categoría. */
  concept: requiredText(120),
  merchant: optionalText(80),
  notes: optionalText(1000),
  paymentMethod: z.enum(PaymentMethod, { error: 'Usa cash, transfer o card' }),
  /** Obligatorio con card; la cuenta sale de la tarjeta. */
  cardId: uuidSchema.nullable(),
  /** Obligatorio con cash o transfer. */
  accountId: uuidSchema.nullable(),
};

export const createTransactionSchema = z.object({
  ...transactionFields,
  time: transactionFields.time.default(null),
  merchant: transactionFields.merchant.default(null),
  notes: transactionFields.notes.default(null),
  cardId: transactionFields.cardId.default(null),
  accountId: transactionFields.accountId.default(null),
});

/** Solo los campos que cambian. */
export const updateTransactionSchema = z.object(transactionFields).partial();

export type CreateTransactionDto = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionDto = z.infer<typeof updateTransactionSchema>;
