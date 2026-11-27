import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * - `api-gateway`: la app corre en Lambda detrás de API Gateway, que ya
 *   validó el JWT (o la firma IAM en /internal/*); se leen los claims del
 *   evento. La Lambda está en la VPC sin NAT, así que no podría bajar las
 *   llaves públicas de Cognito.
 * - `jwt`: la app verifica el token por su cuenta (desarrollo local y pruebas).
 */
export type AuthMode = 'api-gateway' | 'jwt';

export interface AppConfig {
  authMode: AuthMode;
  cognito: {
    userPoolId: string;
    clientIds: string[];
  };
  corsOrigins: string[];
  /**
   * Modo `jwt`: llave compartida con mincome-ai-wrapper para /internal/*;
   * null las deja cerradas.
   */
  internalApiKey: string | null;
  /**
   * Modo `api-gateway`: roles IAM que pueden llamar /internal/* (el de la
   * Lambda de mincome-ai-wrapper). Vacío las deja cerradas.
   */
  internalCallerRoleArns: string[];
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

const IAM_ROLE_ARN = /^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@/-]+$/;

const environmentSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    AUTH_MODE: z
      .enum(['api-gateway', 'jwt'], {
        error: 'AUTH_MODE must be api-gateway or jwt',
      })
      .optional(),
    AWS_LAMBDA_FUNCTION_NAME: z.string().optional(),
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
    INTERNAL_CALLER_ROLE_ARNS: commaSeparated.refine(
      (arns) => arns.every((arn) => IAM_ROLE_ARN.test(arn)),
      {
        error:
          'Each INTERNAL_CALLER_ROLE_ARNS entry must look like arn:aws:iam::123456789012:role/name',
      },
    ),
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
    AUTH_MODE: read('AUTH_MODE') || undefined,
    AWS_LAMBDA_FUNCTION_NAME: read('AWS_LAMBDA_FUNCTION_NAME') || undefined,
    COGNITO_USER_POOL_ID: read('COGNITO_USER_POOL_ID'),
    COGNITO_CLIENT_IDS: read('COGNITO_CLIENT_IDS'),
    CORS_ORIGINS: read('CORS_ORIGINS'),
    INTERNAL_API_KEY: read('INTERNAL_API_KEY') || undefined,
    INTERNAL_CALLER_ROLE_ARNS: read('INTERNAL_CALLER_ROLE_ARNS'),
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
    // En Lambda, por omisión se confía en lo que validó API Gateway.
    authMode:
      env.AUTH_MODE ?? (env.AWS_LAMBDA_FUNCTION_NAME ? 'api-gateway' : 'jwt'),
    cognito: {
      userPoolId: env.COGNITO_USER_POOL_ID,
      clientIds: env.COGNITO_CLIENT_IDS,
    },
    corsOrigins:
      env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : DEFAULT_CORS_ORIGINS,
    internalApiKey: env.INTERNAL_API_KEY ?? null,
    internalCallerRoleArns: env.INTERNAL_CALLER_ROLE_ARNS,
    idempotencyEncryptionKeys: env.IDEMPOTENCY_ENCRYPTION_KEYS,
  };
}
