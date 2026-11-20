import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AppConfig } from '../config/app-config';
import type { TokenIdentity } from './auth-user';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  /** Lanza un error si el token no es válido. */
  verify(token: string): Promise<TokenIdentity>;
}

function createJwtVerifier({ userPoolId, clientIds }: AppConfig['cognito']) {
  // tokenUse null acepta el ID token y el access token: con el ID token,
  // GET /me puede crear al usuario si el trigger de Cognito no lo creó.
  return CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: null,
    clientId: clientIds,
  });
}

function stringClaim(
  payload: Record<string, unknown>,
  name: string,
): string | null {
  const value = payload[name];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Verifica el JWT de Cognito: firma contra las llaves públicas del user pool,
 * iss, expiración, token_use y el app client (aud o client_id). API Gateway
 * también lo valida; aquí se repite para que la API no dependa de que el
 * autorizador esté bien configurado.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  readonly jwtVerifier: ReturnType<typeof createJwtVerifier>;

  constructor(config: AppConfig['cognito']) {
    this.jwtVerifier = createJwtVerifier(config);
  }

  async verify(token: string): Promise<TokenIdentity> {
    const payload = (await this.jwtVerifier.verify(token)) as Record<
      string,
      unknown
    >;
    const groups = payload['cognito:groups'];
    return {
      sub: String(payload.sub),
      email: stringClaim(payload, 'email'),
      name: stringClaim(payload, 'name'),
      groups: Array.isArray(groups) ? groups.map(String) : [],
      termsVersion: stringClaim(payload, 'custom:terminos_version'),
    };
  }
}
