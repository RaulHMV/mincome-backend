import type { AiUsageDto, PlanDto } from '../plans/plan.mapper';

/** Contrato §2, `User`. */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  currency: string;
  timeZone: string;
  termsVersion: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  plan: PlanDto;
  aiUsage: AiUsageDto;
}
