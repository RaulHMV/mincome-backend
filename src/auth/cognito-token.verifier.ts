import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AppConfig } from '../config/app-config';
import type { TokenIdentity } from './auth-user';
import { identityFromClaims, type Claims } from './cognito-claims';

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

/**
 * Modo `jwt` (desarrollo local y pruebas): verifica el JWT de Cognito con las
 * llaves públicas del user pool, iss, expiración, token_use y el app client
 * (aud o client_id). En Lambda lo hace API Gateway; ver AuthGuard.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  readonly jwtVerifier: ReturnType<typeof createJwtVerifier>;

  constructor(config: AppConfig['cognito']) {
    this.jwtVerifier = createJwtVerifier(config);
  }

  async verify(token: string): Promise<TokenIdentity> {
    const payload = await this.jwtVerifier.verify(token);
    return identityFromClaims(payload as Claims);
  }
}
