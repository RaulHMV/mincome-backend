import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  cognito: {
    userPoolId: string;
    clientIds: string[];
  };
  corsOrigins: string[];
  /** Llave compartida con mincome-ai-wrapper para /internal/*; null las deja cerradas. */
  internalApiKey: string | null;
  /** Llaves AES-256-GCM de las respuestas guardadas por Idempotency-Key, la más nueva primero. */
  idempotencyEncryptionKeys: string[];
}

// Contrato §1, "Infraestructura": el front en desarrollo y Capacitor.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'https://localhost',
  'capacitor://localhost',
];

const commaSeparated = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    COGNITO_USER_POOL_ID: z
      .string({ error: 'COGNITO_USER_POOL_ID is required' })
      .regex(/^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/, {
        error: 'COGNITO_USER_POOL_ID must look like us-east-1_AbCdEfGhI',
      }),
    COGNITO_CLIENT_IDS: commaSeparated.refine((ids) => ids.length > 0, {
      error: 'COGNITO_CLIENT_IDS needs at least one app client id',
    }),
    CORS_ORIGINS: commaSeparated,
    INTERNAL_API_KEY: z
      .string()
      .min(32, { error: 'INTERNAL_API_KEY must have at least 32 characters' })
      .optional(),
    IDEMPOTENCY_ENCRYPTION_KEYS: commaSeparated.refine(
      (keys) => keys.every((key) => key.length >= 32),
      {
        error:
          'Each IDEMPOTENCY_ENCRYPTION_KEYS key must have at least 32 characters',
      },
    ),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      env.IDEMPOTENCY_ENCRYPTION_KEYS.length > 0,
    {
      error:
        'IDEMPOTENCY_ENCRYPTION_KEYS is required in production: stored responses contain financial data',
      path: ['IDEMPOTENCY_ENCRYPTION_KEYS'],
    },
  );

export function loadAppConfig(
  read: (name: string) => string | undefined,
): AppConfig {
  const result = environmentSchema.safeParse({
    NODE_ENV: read('NODE_ENV'),
    COGNITO_USER_POOL_ID: read('COGNITO_USER_POOL_ID'),
    COGNITO_CLIENT_IDS: read('COGNITO_CLIENT_IDS'),
    CORS_ORIGINS: read('CORS_ORIGINS'),
    INTERNAL_API_KEY: read('INTERNAL_API_KEY') || undefined,
    IDEMPOTENCY_ENCRYPTION_KEYS: read('IDEMPOTENCY_ENCRYPTION_KEYS'),
  });
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const env = result.data;
  return {
    cognito: {
      userPoolId: env.COGNITO_USER_POOL_ID,
      clientIds: env.COGNITO_CLIENT_IDS,
    },
    corsOrigins:
      env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : DEFAULT_CORS_ORIGINS,
    internalApiKey: env.INTERNAL_API_KEY ?? null,
    idempotencyEncryptionKeys: env.IDEMPOTENCY_ENCRYPTION_KEYS,
  };
}
