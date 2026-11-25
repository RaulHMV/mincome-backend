import type { AppConfig } from '../config/app-config';
import type { TokenIdentity } from './auth-user';

export type Claims = Record<string, unknown>;

function stringClaim(claims: Claims, name: string): string | null {
  const value = claims[name];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * El JWT trae los arreglos como arreglos, pero el autorizador JWT de HTTP API
 * los pasa como texto: `"[normal premium]"`. Los nombres de grupo de Cognito
 * no llevan espacios.
 */
export function listClaim(claims: Claims, name: string): string[] {
  const value = claims[name];
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .trim()
    .replace(/^\[(.*)\]$/s, '$1')
    .split(/[\s,]+/)
    .filter((item) => item.length > 0);
}

export function identityFromClaims(claims: Claims): TokenIdentity {
  const sub = stringClaim(claims, 'sub');
  if (!sub) {
    throw new Error('The token has no sub');
  }
  return {
    sub,
    email: stringClaim(claims, 'email'),
    name: stringClaim(claims, 'name'),
    groups: listClaim(claims, 'cognito:groups'),
    termsVersion: stringClaim(claims, 'custom:terminos_version'),
  };
}

export function cognitoIssuer(userPoolId: string): string {
  const region = userPoolId.slice(0, userPoolId.indexOf('_'));
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

/**
 * API Gateway ya verificó la firma. Esto repite, sin criptografía, que el
 * token sea de nuestro user pool y app client y que siga vigente, por si el
 * autorizador quedó configurado con otro pool o sin audiencia.
 */
export function assertClaimsFor(
  { userPoolId, clientIds }: AppConfig['cognito'],
  claims: Claims,
  nowInSeconds: number,
): void {
  if (claims.iss !== cognitoIssuer(userPoolId)) {
    throw new Error('The token is from another issuer');
  }
  const client =
    claims.token_use === 'id'
      ? claims.aud
      : claims.token_use === 'access'
        ? claims.client_id
        : undefined;
  if (typeof client !== 'string' || !clientIds.includes(client)) {
    throw new Error('The token is for another app client');
  }
  const expiresAt = Number(claims.exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowInSeconds) {
    throw new Error('The token expired');
  }
}
