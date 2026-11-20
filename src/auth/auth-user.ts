import type { Request } from 'express';
import type { PlanName } from '../common/enums';

/** El usuario de la petición: sale siempre del token, nunca del body, del query ni de la URL. */
export interface AuthUser {
  /** usuarios.id */
  id: string;
  cognitoSub: string;
  email: string;
  name: string;
  /** El del grupo de Cognito del token (requerimientos-backend.md §5). */
  plan: PlanName;
  /** Decide qué es "hoy" y "este mes" (requerimientos-backend.md §2.6). */
  timeZone: string;
}

/** Lo que el token de Cognito dice de quien llama. */
export interface TokenIdentity {
  sub: string;
  /** Solo el ID token trae correo, nombre y atributos personalizados. */
  email: string | null;
  name: string | null;
  groups: string[];
  termsVersion: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
