import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import {
  TOKEN_VERIFIER,
  type CognitoTokenVerifier,
} from '../../src/auth/cognito-token.verifier';
import { createDataSourceOptions } from '../../src/database.config';
import { idTokenFor, TEST_JWKS, type TestUser } from './tokens';

/** Borra todo el esquema y lo vuelve a crear con las migraciones. */
export async function resetDatabase(): Promise<void> {
  const dataSource = new DataSource(createDataSourceOptions());
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

export interface TestApp {
  app: INestApplication;
  dataSource: DataSource;
  /** Peticiones como `user`, con su ID token. */
  as(user: TestUser): UserClient;
  anonymous(): ReturnType<typeof request>;
  close(): Promise<void>;
}

export interface UserClient {
  get(path: string): request.Test;
  post(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  app
    .get<CognitoTokenVerifier>(TOKEN_VERIFIER)
    .jwtVerifier.cacheJwks(TEST_JWKS);

  const server = app.getHttpServer();
  const withToken = (test: request.Test, user: TestUser) =>
    test.set('Authorization', `Bearer ${idTokenFor(user)}`);

  return {
    app,
    dataSource: app.get(DataSource),
    as: (user) => ({
      get: (path) => withToken(request(server).get(`/api/v1${path}`), user),
      post: (path) => withToken(request(server).post(`/api/v1${path}`), user),
      patch: (path) => withToken(request(server).patch(`/api/v1${path}`), user),
      put: (path) => withToken(request(server).put(`/api/v1${path}`), user),
      delete: (path) =>
        withToken(request(server).delete(`/api/v1${path}`), user),
    }),
    anonymous: () => request(server),
    close: () => app.close(),
  };
}
