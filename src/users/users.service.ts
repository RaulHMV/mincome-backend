import { Injectable } from '@nestjs/common';
import type { AuthUser, TokenIdentity } from '../auth/auth-user';
import {
  firstDayOfMonth,
  formatTimestamp,
  formatTimestampOrNull,
  monthOf,
  todayIn,
} from '../common/dates';
import { PlanName } from '../common/enums';
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
} from '../common/errors/api-error';
import { AiQuotasRepository } from '../plans/ai-quotas.repository';
import { toPlanDto } from '../plans/plan.mapper';
import { PlansRepository } from '../plans/plans.repository';
import type { UpdateMeDto } from './dto/update-me.dto';
import type { UserDto } from './user.mapper';
import { UsersRepository, type NewUser } from './users.repository';

export function planFromGroups(groups: string[]): PlanName {
  return groups.includes(PlanName.PREMIUM) ? PlanName.PREMIUM : PlanName.NORMAL;
}

/** El primer día del mes de hoy en la zona del usuario: el periodo de cuotas_ia. */
export function currentQuotaPeriod(timeZone: string, now = new Date()): string {
  return firstDayOfMonth(monthOf(todayIn(timeZone, now)));
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly plansRepository: PlansRepository,
    private readonly aiQuotasRepository: AiQuotasRepository,
  ) {}

  /**
   * El usuario de un token ya verificado. Si no existe todavía (el trigger
   * Post confirmation de Cognito no corrió), lo crea con los datos del ID
   * token. El plan es el del grupo de Cognito; usuarios.plan_id se ajusta si
   * no coincide.
   */
  async resolve(identity: TokenIdentity): Promise<AuthUser> {
    let user = await this.usersRepository.findIdentityBySub(identity.sub);
    if (!user) {
      if (!identity.email || !identity.name) {
        throw new UnauthenticatedError(
          'Todavía no terminamos de crear tu cuenta. Cierra sesión y vuelve a entrar.',
        );
      }
      user = await this.provision({
        cognitoSub: identity.sub,
        email: identity.email,
        name: identity.name,
        termsVersion: identity.termsVersion,
      });
    }
    if (!user.isActive) {
      throw new UnauthenticatedError('Tu cuenta está desactivada.');
    }

    const plan = planFromGroups(identity.groups);
    if (user.plan !== plan) {
      await this.usersRepository.updatePlan(user.id, plan);
    }
    return {
      id: user.id,
      cognitoSub: user.cognitoSub,
      email: user.email,
      name: user.name,
      plan,
      timeZone: user.timeZone,
    };
  }

  /** Lo usa también el trigger Post confirmation de Cognito. Si ya existe, no hace nada. */
  async provision(newUser: NewUser) {
    await this.usersRepository.create(newUser);
    const user = await this.usersRepository.findIdentityBySub(
      newUser.cognitoSub,
    );
    if (!user) {
      throw new ConflictError('Ya existe una cuenta con este correo.');
    }
    return user;
  }

  async getMe(
    authUser: AuthUser,
    { isLogin }: { isLogin: boolean },
  ): Promise<UserDto> {
    if (isLogin) {
      await this.usersRepository.touchLastLogin(authUser.id);
    }
    const profile = await this.usersRepository.findProfile(authUser.id);
    if (!profile) {
      throw new NotFoundError();
    }
    const plan = await this.plansRepository.findByName(authUser.plan);
    const aiUsage = await this.aiQuotasRepository.findUsage(
      authUser.id,
      currentQuotaPeriod(profile.timeZone),
    );
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      currency: profile.currency,
      timeZone: profile.timeZone,
      termsVersion: profile.termsVersion,
      lastLoginAt: formatTimestampOrNull(profile.lastLoginAt, profile.timeZone),
      createdAt: formatTimestamp(profile.createdAt, profile.timeZone),
      plan: toPlanDto(plan),
      aiUsage,
    };
  }

  async updateMe(authUser: AuthUser, changes: UpdateMeDto): Promise<UserDto> {
    await this.usersRepository.updateProfile(authUser.id, changes);
    return this.getMe(
      { ...authUser, timeZone: changes.timeZone ?? authUser.timeZone },
      { isLogin: false },
    );
  }
}
