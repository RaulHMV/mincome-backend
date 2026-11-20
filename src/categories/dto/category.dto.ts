import { z } from 'zod';
import { CategoryAppliesTo } from '../../common/enums';
import {
  booleanQuerySchema,
  requiredText,
} from '../../common/validation/schemas';

/** Clave de ícono, no el SVG: un nombre de Lucide como 'paw-print' (requerimientos-backend.md §2.10). */
export const iconKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: "Usa la clave del ícono, como 'paw-print'",
  })
  .max(40, { error: 'Máximo 40 caracteres' });

export const listCategoriesQuerySchema = z.object({
  appliesTo: z
    .enum(CategoryAppliesTo, { error: 'Usa income, expense o both' })
    .optional(),
  includeInactive: booleanQuerySchema.optional().default(false),
});

export const createCategorySchema = z.object({
  name: requiredText(50),
  icon: iconKeySchema.nullable().default(null),
  appliesTo: z.enum(CategoryAppliesTo, { error: 'Usa income, expense o both' }),
});

/** El tipo aplicable no cambia: los movimientos que ya tiene dejarían de ser compatibles. */
export const updateCategorySchema = z.object({
  name: requiredText(50).optional(),
  icon: iconKeySchema.nullable().optional(),
  isActive: z.boolean({ error: 'Usa true o false' }).optional(),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
