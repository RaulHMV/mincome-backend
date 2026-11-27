import { z } from 'zod';
import { requiredText, timeZoneSchema } from '../../common/validation/schemas';

export const updateMeSchema = z.object({
  name: requiredText(100).optional(),
  timeZone: timeZoneSchema.optional(),
  /** Aceptar una versión nueva de los términos (requerimientos-backend.md §2.7). */
  termsVersion: requiredText(20).optional(),
});

export type UpdateMeDto = z.infer<typeof updateMeSchema>;
