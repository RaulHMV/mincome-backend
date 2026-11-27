import { Controller, Get } from '@nestjs/common';
import { toPlanDto, type PlanDto } from './plan.mapper';
import { PlansRepository } from './plans.repository';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansRepository: PlansRepository) {}

  @Get()
  async findAll(): Promise<PlanDto[]> {
    const plans = await this.plansRepository.findActive();
    return plans.map(toPlanDto);
  }
}
