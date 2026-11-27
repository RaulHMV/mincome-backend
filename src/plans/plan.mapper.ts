import { toMoney } from '../common/money';
import type { AiUsageRow } from './ai-quotas.repository';
import type { Plan } from './plan.entity';

export interface PlanDto {
  id: number;
  name: string;
  monthlyPrice: number;
  includesAssistant: boolean;
  monthlyQueryLimit: number;
  monthlyTokenLimit: number;
}

export type AiUsageDto = AiUsageRow;

export function toPlanDto(plan: Plan): PlanDto {
  return {
    id: plan.id,
    name: plan.name,
    monthlyPrice: toMoney(plan.monthlyPrice),
    includesAssistant: plan.includesAssistant,
    monthlyQueryLimit: plan.monthlyQueryLimit,
    monthlyTokenLimit: plan.monthlyTokenLimit,
  };
}
