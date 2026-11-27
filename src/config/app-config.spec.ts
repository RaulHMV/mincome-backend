import { loadAppConfig } from './app-config';

function readerOf(env: Record<string, string>) {
  return (name: string) => env[name];
}

const VALID = {
  COGNITO_USER_POOL_ID: 'us-east-1_AbCdEfGhI',
  COGNITO_CLIENT_IDS: 'web-client, mobile-client',
};

describe('loadAppConfig', () => {
  it('lee Cognito y usa los orígenes de desarrollo por defecto', () => {
    expect(loadAppConfig(readerOf(VALID))).toEqual({
      authMode: 'jwt',
      cognito: {
        userPoolId: 'us-east-1_AbCdEfGhI',
        clientIds: ['web-client', 'mobile-client'],
      },
      corsOrigins: [
        'http://localhost:5173',
        'https://localhost',
        'capacitor://localhost',
      ],
      internalApiKey: null,
      internalCallerRoleArns: [],
      idempotencyEncryptionKeys: [],
    });
  });

  it('en Lambda confía por omisión en lo que validó API Gateway', () => {
    const inLambda = { ...VALID, AWS_LAMBDA_FUNCTION_NAME: 'mincome-backend' };
    expect(loadAppConfig(readerOf(inLambda)).authMode).toBe('api-gateway');
    expect(
      loadAppConfig(readerOf({ ...inLambda, AUTH_MODE: 'jwt' })).authMode,
    ).toBe('jwt');
    expect(() =>
      loadAppConfig(readerOf({ ...VALID, AUTH_MODE: 'ninguno' })),
    ).toThrow('AUTH_MODE must be api-gateway or jwt');
  });

  it('lee los roles IAM que pueden llamar /internal/*', () => {
    const arn = 'arn:aws:iam::123456789012:role/mincome-ai-wrapper';
    expect(
      loadAppConfig(readerOf({ ...VALID, INTERNAL_CALLER_ROLE_ARNS: arn }))
        .internalCallerRoleArns,
    ).toEqual([arn]);
    expect(() =>
      loadAppConfig(
        readerOf({ ...VALID, INTERNAL_CALLER_ROLE_ARNS: 'mincome-ai-wrapper' }),
      ),
    ).toThrow('INTERNAL_CALLER_ROLE_ARNS');
  });

  it('rechaza un user pool mal escrito', () => {
    expect(() =>
      loadAppConfig(readerOf({ ...VALID, COGNITO_USER_POOL_ID: 'pool' })),
    ).toThrow('COGNITO_USER_POOL_ID must look like us-east-1_AbCdEfGhI');
  });

  it('pide las llaves de idempotencia en producción', () => {
    expect(() =>
      loadAppConfig(readerOf({ ...VALID, NODE_ENV: 'production' })),
    ).toThrow('IDEMPOTENCY_ENCRYPTION_KEYS is required in production');
  });

  it('rechaza llaves cortas', () => {
    expect(() =>
      loadAppConfig(
        readerOf({ ...VALID, IDEMPOTENCY_ENCRYPTION_KEYS: 'corta' }),
      ),
    ).toThrow('at least 32 characters');
    expect(() =>
      loadAppConfig(readerOf({ ...VALID, INTERNAL_API_KEY: 'corta' })),
    ).toThrow('INTERNAL_API_KEY must have at least 32 characters');
  });
});
