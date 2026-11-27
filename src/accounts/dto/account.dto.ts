import { z } from 'zod';
import { AccountType } from '../../common/enums';
import {
  balanceSchema,
  booleanQuerySchema,
  isoDateSchema,
  requiredText,
} from '../../common/validation/schemas';

export const listAccountsQuerySchema = z.object({
  includeInactive: booleanQuerySchema.optional().default(false),
});

/** Efectivo o débito; las cuentas de crédito se crean con POST /cards. */
export const createAccountSchema = z.object({
  name: requiredText(50),
  type: z.enum([AccountType.CASH, AccountType.DEBIT], {
    error:
      'Usa cash o debit; las cuentas de crédito se crean al dar de alta la tarjeta',
  }),
  initialBalance: balanceSchema.default(0),
  /** Por defecto, hoy en la zona del usuario. */
  initialBalanceDate: isoDateSchema.optional(),
});

export const updateAccountSchema = z.object({
  name: requiredText(50).optional(),
  initialBalance: balanceSchema.optional(),
  initialBalanceDate: isoDateSchema.optional(),
  isActive: z.boolean({ error: 'Usa true o false' }).optional(),
});

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type UpdateAccountDto = z.infer<typeof updateAccountSchema>;
