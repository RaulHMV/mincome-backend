import { IdempotencyStorage } from '@nestjs/idempotency';
import { idempotencyStoreContract } from '@nestjs/idempotency/testing';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../src/database.config';
import { IdempotencyKey } from '../src/idempotency/idempotency-key.entity';
import { TypeOrmIdempotencyStore } from '../src/idempotency/typeorm-idempotency.store';
import { resetDatabase } from './support/test-app';

// El contrato de @nestjs/idempotency sobre PostgreSQL de verdad, con 32
// llamadas compitiendo por la misma llave en un pool de 16 conexiones.
describe('TypeOrmIdempotencyStore cumple el contrato de @nestjs/idempotency (e2e)', () => {
  let dataSource: DataSource;
  let store: TypeOrmIdempotencyStore;

  beforeAll(async () => {
    await resetDatabase();
    dataSource = await new DataSource({
      ...createDataSourceOptions(),
      entities: [IdempotencyKey],
      extra: { max: 16 },
    }).initialize();
    store = new TypeOrmIdempotencyStore(dataSource, new IdempotencyStorage());
  });

  afterAll(() => dataSource.destroy());

  // El store lee Date.now(): solo se finge Date, para que el driver conserve sus timers.
  beforeEach(() =>
    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    }),
  );
  afterEach(() => jest.useRealTimers());

  const cases = idempotencyStoreContract(() => store, {
    advanceTime: (ms) => jest.setSystemTime(Date.now() + ms),
    concurrent: { callers: 32 },
  });
  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }

  it('prune() borra solo los registros expirados', async () => {
    jest.useRealTimers();
    await store.acquire('vigente', 'owner', 'huella', 60_000);
    await store.acquire('expirada', 'owner', 'huella', 1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await store.prune()).toBeGreaterThanOrEqual(1);
    const keys: { llave: string }[] = await dataSource.query(
      'SELECT llave FROM llaves_idempotencia',
    );
    expect(keys.map((row) => row.llave)).toContain('vigente');
    expect(keys.map((row) => row.llave)).not.toContain('expirada');
  });
});
