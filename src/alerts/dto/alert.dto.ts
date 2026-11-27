import { z } from 'zod';

export const updateAlertSchema = z.object({
  isRead: z.boolean({ error: 'Usa true o false' }),
});

export type UpdateAlertDto = z.infer<typeof updateAlertSchema>;
