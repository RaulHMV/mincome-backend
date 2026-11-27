import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import {
  budgetMonthQuerySchema,
  type BudgetMonthQuery,
} from '../budgets/dto/budget.dto';
import { DashboardService, type DashboardDto } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** `month` por defecto es el actual; un mes cerrado se mide en su último día. */
  @Get()
  forMonth(
    @CurrentUser() user: AuthUser,
    @Query({ schema: budgetMonthQuerySchema }) query: BudgetMonthQuery,
  ): Promise<DashboardDto> {
    return this.dashboardService.forMonth(user, query.month);
  }
}
