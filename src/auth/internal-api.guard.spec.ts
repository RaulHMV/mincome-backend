import type { ExecutionContext } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import type { AppConfig } from '../config/app-config';
import {
  runWithApiGatewayEvent,
  type ApiGatewayHttpEvent,
} from '../lambda/api-gateway-event';
import {
  INTERNAL_API_KEY_HEADER,
  InternalApiGuard,
} from './internal-api.guard';

const KEY = 'test-only-internal-api-key-of-32-chars';
const WRAPPER_ROLE = 'arn:aws:iam::123456789012:role/mincome-ai-wrapper';

function configFor(changes: Partial<AppConfig>): AppConfig {
  return {
    authMode: 'jwt',
    cognito: { userPoolId: 'us-east-1_AbCdEfGhI', clientIds: ['web-client'] },
    corsOrigins: [],
    internalApiKey: KEY,
    internalCallerRoleArns: [WRAPPER_ROLE],
    idempotencyEncryptionKeys: [],
    ...changes,
  };
}

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  const request = { header: (name: string) => headers[name.toLowerCase()] };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function eventSignedBy(userArn: string | null): ApiGatewayHttpEvent {
  return {
    version: '2.0',
    rawPath: '/api/v1/internal/chat-turns',
    requestContext: {
      http: { method: 'POST' },
      authorizer: userArn ? { iam: { userArn } } : undefined,
    },
  } as unknown as ApiGatewayHttpEvent;
}

describe('InternalApiGuard', () => {
  describe('modo api-gateway (Lambda)', () => {
    const guard = new InternalApiGuard(configFor({ authMode: 'api-gateway' }));
    const allows = (userArn: string | null, headers = {}) =>
      runWithApiGatewayEvent(eventSignedBy(userArn), () => {
        try {
          return guard.canActivate(contextWithHeaders(headers));
        } catch {
          return false;
        }
      });

    it('deja pasar al rol de la Lambda del wrapper', () => {
      expect(
        allows(
          'arn:aws:sts::123456789012:assumed-role/mincome-ai-wrapper/session',
        ),
      ).toBe(true);
    });

    it('rechaza otro rol, otra cuenta, la falta de firma IAM o solo la llave', () => {
      expect(
        allows('arn:aws:sts::123456789012:assumed-role/otro-rol/session'),
      ).toBe(false);
      expect(
        allows(
          'arn:aws:sts::999999999999:assumed-role/mincome-ai-wrapper/session',
        ),
      ).toBe(false);
      expect(allows(null)).toBe(false);
      expect(allows(null, { [INTERNAL_API_KEY_HEADER]: KEY })).toBe(false);
    });

    it('sin roles configurados quedan cerradas', () => {
      const closed = new InternalApiGuard(
        configFor({ authMode: 'api-gateway', internalCallerRoleArns: [] }),
      );
      expect(() =>
        runWithApiGatewayEvent(
          eventSignedBy(
            'arn:aws:sts::123456789012:assumed-role/mincome-ai-wrapper/s',
          ),
          () => closed.canActivate(contextWithHeaders({})),
        ),
      ).toThrow(ApiError);
    });
  });

  describe('modo jwt (local)', () => {
    it('pide la llave compartida', () => {
      const guard = new InternalApiGuard(configFor({}));
      expect(
        guard.canActivate(
          contextWithHeaders({ [INTERNAL_API_KEY_HEADER]: KEY }),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextWithHeaders({ [INTERNAL_API_KEY_HEADER]: `${KEY}x` }),
        ),
      ).toThrow();
      expect(() => guard.canActivate(contextWithHeaders({}))).toThrow();
    });

    it('sin INTERNAL_API_KEY quedan cerradas', () => {
      const guard = new InternalApiGuard(configFor({ internalApiKey: null }));
      expect(() =>
        guard.canActivate(
          contextWithHeaders({ [INTERNAL_API_KEY_HEADER]: KEY }),
        ),
      ).toThrow();
    });
  });
});
