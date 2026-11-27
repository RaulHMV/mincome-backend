import { z } from 'zod';
import { AccountType } from '../../common/enums';
import {
  isoDateSchema,
  paginationQuerySchema,
  uuidSchema,
} from '../../common/validation/schemas';

export enum MovementKind {
  INCOME = 'income',
  EXPENSE = 'expense',
  POCKET_DEPOSIT = 'pocketDeposit',
  POCKET_WITHDRAWAL = 'pocketWithdrawal',
  TRANSFER = 'transfer',
}

const KINDS = new Set<string>(Object.values(MovementKind));

/** NUMERIC(12,2), como los montos que se guardan. */
const MAX_AMOUNT = 9_999_999_999.99;

const amountFilterSchema = z.coerce
  .number({ error: 'Usa un monto numérico' })
  .min(0, { error: 'No puede ser negativo' })
  .max(MAX_AMOUNT, { error: 'El monto excede el límite permitido' });

/** Contrato §3.3, "Filtros de GET /movements": todos opcionales y combinables. */
export const searchMovementsQuerySchema = paginationQuerySchema
  .extend({
    /** Uno o varios separados por coma: `expense,income`. */
    kind: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((kind) => kind.trim())
          .filter((kind) => kind.length > 0),
      )
      .refine(
        (kinds) => kinds.length > 0 && kinds.every((kind) => KINDS.has(kind)),
        {
          error:
            'Usa income, expense, pocketDeposit, pocketWithdrawal o transfer, separados por coma',
        },
      )
      .transform((kinds) => [...new Set(kinds)] as MovementKind[])
      .optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** Concepto, comercio, notas, categoría, cuenta o tarjeta, sin importar acentos. */
    q: z
      .string()
      .trim()
      .max(100, { error: 'Máximo 100 caracteres' })
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    categoryId: z.coerce
      .number({ error: 'Identificador inválido' })
      .int({ error: 'Identificador inválido' })
      .positive({ error: 'Identificador inválido' })
      .max(2_147_483_647, { error: 'Identificador inválido' })
      .optional(),
    accountType: z
      .enum(AccountType, { error: 'Usa cash, debit o credit' })
      .optional(),
    accountId: uuidSchema.optional(),
    cardId: uuidSchema.optional(),
    minAmount: amountFilterSchema.optional(),
    maxAmount: amountFilterSchema.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Debe ser igual o posterior a la fecha inicial',
      });
    }
    if (
      query.minAmount !== undefined &&
      query.maxAmount !== undefined &&
      query.minAmount > query.maxAmount
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxAmount'],
        message: 'Debe ser mayor o igual al monto mínimo',
      });
    }
  });

export type SearchMovementsQuery = z.infer<typeof searchMovementsQuerySchema>;
