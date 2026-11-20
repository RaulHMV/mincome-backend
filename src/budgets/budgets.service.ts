import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import {
  firstDayOfMonth,
  lastDayOfMonth,
  monthOf,
  todayIn,
} from '../common/dates';
import { AlertLevel, FlowType } from '../common/enums';
import { ApiError, ValidationError } from '../common/errors/api-error';
import { centsToNumeric, toCents } from '../common/money';
import { crossedAlertLevel } from './budget.calculator';
import { byPercentageDesc, toBudgetDto, type BudgetDto } from './budget.mapper';
import { BudgetsRepository } from './budgets.repository';
import type { PutBudgetsDto } from './dto/budget.dto';

const DEFAULT_ALERT_THRESHOLD = 80;

function monthRange(month: string) {
  return { start: firstDayOfMonth(month), end: lastDayOfMonth(month) };
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly budgetsRepository: BudgetsRepository,
    private readonly categoriesService: CategoriesService,
  ) {}

  currentMonth(user: AuthUser): string {
    return monthOf(todayIn(user.timeZone));
  }

  /** Los presupuestos activos del mes, con lo gastado. */
  async listForMonth(
    userId: string,
    month: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<BudgetDto[]> {
    const range = monthRange(month);
    const budgets = await this.budgetsRepository.findEffective(
      userId,
      range.start,
      {},
      manager,
    );
    const spent = await this.budgetsRepository.spentByCategory(
      manager,
      userId,
      range,
      {
        categoryIds: budgets.map((budget) => budget.categoryId),
      },
    );
    return budgets
      .map((budget) => toBudgetDto(budget, spent.get(budget.categoryId) ?? 0))
      .sort(byPercentageDesc);
  }

  /**
   * El presupuesto de una categoría en el mes de `date`, o null si no tiene.
   * `extraSpentCents` suma un gasto que todavía no se guarda (?dryRun=true).
   */
  async forCategory(
    manager: EntityManager,
    userId: string,
    categoryId: number,
    date: string,
    extraSpentCents = 0,
  ): Promise<BudgetDto | null> {
    const range = monthRange(monthOf(date));
    const [budget] = await this.budgetsRepository.findEffective(
      userId,
      range.start,
      { categoryIds: [categoryId] },
      manager,
    );
    if (!budget) {
      return null;
    }
    const spent = await this.budgetsRepository.spentByCategory(
      manager,
      userId,
      range,
      {
        categoryIds: [categoryId],
      },
    );
    return toBudgetDto(budget, (spent.get(categoryId) ?? 0) + extraSpentCents);
  }

  /**
   * El nivel_alerta de un gasto (requerimientos-backend.md §3.3): contra el
   * mes de su fecha, y solo si cruza un umbral. Bloquea la fila del
   * presupuesto para que dos gastos simultáneos no crucen los dos.
   */
  async crossedLevel(
    manager: EntityManager,
    userId: string,
    expense: {
      categoryId: number;
      date: string;
      amountCents: number;
      excludeTransactionId?: string;
    },
  ): Promise<AlertLevel> {
    const range = monthRange(monthOf(expense.date));
    const [budget] = await this.budgetsRepository.findEffective(
      userId,
      range.start,
      { categoryIds: [expense.categoryId] },
      manager,
    );
    if (!budget) {
      return AlertLevel.NONE;
    }
    await this.budgetsRepository.lock(manager, budget.id);
    const spent = await this.budgetsRepository.spentByCategory(
      manager,
      userId,
      range,
      {
        categoryIds: [expense.categoryId],
        excludeTransactionId: expense.excludeTransactionId,
      },
    );
    const spentBeforeCents = spent.get(expense.categoryId) ?? 0;
    return crossedAlertLevel({
      spentBeforeCents,
      spentAfterCents: spentBeforeCents + expense.amountCents,
      limitCents: toCents(budget.limit),
      alertThreshold: budget.alertThreshold,
    });
  }

  /**
   * PUT /budgets: crea o actualiza la versión del mes de cada categoría
   * (requerimientos-backend.md §2.5). Lo que no se manda se copia de la versión
   * vigente; `limit` es obligatorio solo si la categoría no tenía presupuesto.
   */
  async upsertForMonth(
    user: AuthUser,
    month: string,
    changes: PutBudgetsDto,
  ): Promise<BudgetDto[]> {
    const monthStart = firstDayOfMonth(month);
    await this.dataSource.transaction(async (manager) => {
      const current = new Map(
        (
          await this.budgetsRepository.findEffective(
            user.id,
            monthStart,
            {
              categoryIds: changes.map((change) => change.categoryId),
              includeInactive: true,
            },
            manager,
          )
        ).map((budget) => [budget.categoryId, budget]),
      );

      for (const [index, change] of changes.entries()) {
        const effective = current.get(change.categoryId);
        if (change.isActive === false) {
          if (effective?.isActive) {
            await this.budgetsRepository.upsertVersion(manager, user.id, {
              categoryId: change.categoryId,
              effectiveFrom: monthStart,
              limit:
                change.limit !== undefined
                  ? centsToNumeric(toCents(change.limit))
                  : effective.limit,
              alertThreshold: change.alertThreshold ?? effective.alertThreshold,
              isActive: false,
            });
          }
          continue;
        }

        await this.requireExpenseCategory(user.id, change.categoryId, index);
        const limit =
          change.limit !== undefined
            ? centsToNumeric(toCents(change.limit))
            : effective?.limit;
        if (limit === undefined) {
          throw ValidationError.forField(
            `${index}.limit`,
            'Es obligatorio al crear el presupuesto',
          );
        }
        await this.budgetsRepository.upsertVersion(manager, user.id, {
          categoryId: change.categoryId,
          effectiveFrom: monthStart,
          limit,
          alertThreshold:
            change.alertThreshold ??
            effective?.alertThreshold ??
            DEFAULT_ALERT_THRESHOLD,
          isActive: true,
        });
      }
    });
    return this.listForMonth(user.id, month);
  }

  /** Presupuestos solo sobre categorías de gasto o "ambos" (requerimientos-backend.md §4). */
  private async requireExpenseCategory(
    userId: string,
    categoryId: number,
    index: number,
  ) {
    try {
      await this.categoriesService.requireUsable(
        userId,
        categoryId,
        FlowType.EXPENSE,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        const body = error.getResponse() as {
          error: { fields: Record<string, string> | null };
        };
        throw ValidationError.forField(
          `${index}.categoryId`,
          body.error.fields?.categoryId ?? 'Categoría inválida',
        );
      }
      throw error;
    }
  }
}
