// Corre antes de cada archivo de pruebas e2e, antes de importar AppModule.
// La base de pruebas se borra y se vuelve a migrar en cada archivo: nunca
// apuntes TEST_DB_* a una base con datos que quieras conservar.

process.env.DB_HOST = process.env.TEST_DB_HOST ?? 'localhost';
process.env.DB_PORT = process.env.TEST_DB_PORT ?? '5432';
process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'mincome_test';
process.env.DB_USER = process.env.TEST_DB_USER ?? 'postgres';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? 'postgres';
process.env.DB_POOL_MIN = '1';
process.env.DB_RETRY_ATTEMPTS = '1';

process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool1';
process.env.COGNITO_CLIENT_IDS = 'test-client-id';
process.env.INTERNAL_API_KEY = 'test-only-internal-api-key-of-32-chars';
process.env.IDEMPOTENCY_ENCRYPTION_KEYS =
  'test-only-idempotency-key-of-32-characters';
