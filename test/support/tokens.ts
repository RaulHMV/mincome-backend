import { createSign, generateKeyPairSync } from 'node:crypto';

// Tokens firmados como los de Cognito, con un par de llaves de prueba que el
// verificador recibe con cacheJwks(), sin llamar a AWS.

const KEY_ID = 'test-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const { n, e } = publicKey.export({ format: 'jwk' });

export const TEST_JWKS = {
  keys: [
    {
      kty: 'RSA',
      n: String(n),
      e: String(e),
      kid: KEY_ID,
      alg: 'RS256',
      use: 'sig',
    },
  ],
};

export const TEST_ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;

export interface TestUser {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
  termsVersion?: string;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: TEST_ISSUER,
    iat: now,
    auth_time: now,
    exp: now + 3600,
    ...claims,
  };
  const data = `${encode({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256')
    .update(data)
    .sign(privateKey)
    .toString('base64url');
  return `${data}.${signature}`;
}

/** Un ID token de Cognito para `user`. */
export function idTokenFor(user: TestUser): string {
  return signToken({
    sub: user.sub,
    token_use: 'id',
    aud: process.env.COGNITO_CLIENT_IDS,
    email: user.email ?? `${user.sub}@correo.com`,
    name: user.name ?? 'Usuario de Prueba',
    'cognito:groups': user.groups ?? [],
    ...(user.termsVersion
      ? { 'custom:terminos_version': user.termsVersion }
      : {}),
  });
}

/** Un access token de Cognito: no trae correo ni nombre. */
export function accessTokenFor(user: TestUser): string {
  return signToken({
    sub: user.sub,
    token_use: 'access',
    client_id: process.env.COGNITO_CLIENT_IDS,
    'cognito:groups': user.groups ?? [],
  });
}
