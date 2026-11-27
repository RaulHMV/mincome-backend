import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiQuota } from './ai-quota.entity';
import { AiQuotasRepository } from './ai-quotas.repository';
import { Plan } from './plan.entity';
import { PlansController } from './plans.controller';
import { PlansRepository } from './plans.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Plan, AiQuota])],
  controllers: [PlansController],
  providers: [PlansRepository, AiQuotasRepository],
  exports: [PlansRepository, AiQuotasRepository],
})
export class PlansModule {}
