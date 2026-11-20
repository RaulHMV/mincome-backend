import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import type { BudgetDto } from './budget.mapper';
import { BudgetsService } from './budgets.service';
import {
  budgetMonthQuerySchema,
  putBudgetsSchema,
  type BudgetMonthQuery,
  type PutBudgetsDto,
} from './dto/budget.dto';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: budgetMonthQuerySchema }) query: BudgetMonthQuery,
  ): Promise<BudgetDto[]> {
    return this.budgetsService.listForMonth(
      user.id,
      query.month ?? this.budgetsService.currentMonth(user),
    );
  }

  /** Excepción del contrato: 200 con todos los presupuestos del mes, no solo los que cambiaron. */
  @Put()
  upsert(
    @CurrentUser() user: AuthUser,
    @Query({ schema: budgetMonthQuerySchema }) query: BudgetMonthQuery,
    @Body({ schema: putBudgetsSchema }) changes: PutBudgetsDto,
  ): Promise<BudgetDto[]> {
    return this.budgetsService.upsertForMonth(
      user,
      query.month ?? this.budgetsService.currentMonth(user),
      changes,
    );
  }
}
