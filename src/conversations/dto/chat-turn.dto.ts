import { z } from 'zod';
import {
  optionalText,
  requiredText,
  uuidSchema,
} from '../../common/validation/schemas';

const tokensSchema = z
  .number({ error: 'Usa un número entero de tokens' })
  .int({ error: 'Usa un número entero de tokens' })
  .min(0, { error: 'No puede ser negativo' })
  .max(1_000_000, { error: 'Demasiados tokens para un turno' });

/** Contrato §3.8, POST /internal/chat-turns. */
export const startChatTurnSchema = z.object({
  /** Lo saca el wrapper del JWT ya validado de POST /chat. */
  userSub: z
    .string({ error: 'Es obligatorio' })
    .trim()
    .min(1, { error: 'Es obligatorio' })
    .max(100, { error: 'Máximo 100 caracteres' }),
  /** null: conversación nueva. */
  conversationId: uuidSchema.nullable().default(null),
  /** requerimientos-ia.md §8: de 1 a 2,000 caracteres. */
  content: requiredText(2000),
});

/** Contrato §3.8, PATCH /internal/chat-turns/:turnId. */
export const finishChatTurnSchema = z.discriminatedUnion(
  'status',
  [
    z.object({
      status: z.literal('completed'),
      assistantMessage: requiredText(10_000),
      toolsUsed: z
        .array(
          z
            .string({ error: 'Usa el nombre de la herramienta' })
            .trim()
            .min(1, { error: 'Usa el nombre de la herramienta' })
            .max(64, { error: 'Máximo 64 caracteres' }),
          { error: 'Manda una lista de herramientas' },
        )
        .max(10, { error: 'Máximo 10 herramientas' })
        .default([]),
      inputTokens: tokensSchema,
      outputTokens: tokensSchema,
      /** Solo en el primer turno de la conversación. */
      title: optionalText(100).optional().default(null),
    }),
    z.object({ status: z.literal('failed') }),
  ],
  { error: 'Usa completed o failed' },
);

export type StartChatTurnDto = z.infer<typeof startChatTurnSchema>;
export type FinishChatTurnDto = z.infer<typeof finishChatTurnSchema>;
