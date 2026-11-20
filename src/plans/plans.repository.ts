import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PlanName } from '../common/enums';
import { Plan } from './plan.entity';

@Injectable()
export class PlansRepository {
  constructor(private readonly dataSource: DataSource) {}

  findActive(): Promise<Plan[]> {
    return this.dataSource.manager.find(Plan, {
      where: { isActive: true },
      order: { id: 'ASC' },
    });
  }

  async findByName(name: PlanName): Promise<Plan> {
    const plan = await this.dataSource.manager.findOneBy(Plan, { name });
    if (!plan) {
      throw new Error(
        `Plan "${name}" is missing; run the SeedCatalogs migration`,
      );
    }
    return plan;
  }
}
