import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PlanName } from '../common/enums';
import { PremiumRequiredError } from '../common/errors/api-error';
import type { AuthenticatedRequest } from './auth-user';

/** Solo el grupo `premium` de Cognito usa a Piggy (requerimientos-backend.md §5). */
@Injectable()
export class PremiumGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.plan !== PlanName.PREMIUM) {
      throw new PremiumRequiredError();
    }
    return true;
  }
}
