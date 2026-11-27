import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import type { BudgetDto } from '../budgets/budget.mapper';
import { BudgetsService } from '../budgets/budgets.service';
import { CardsRepository } from '../cards/cards.repository';
import { firstDayOfMonth, monthOf, todayIn } from '../common/dates';
import { CARD_TYPE_DB, CardType } from '../common/enums';
import { fromCents, toCents } from '../common/money';
import type { MovementDto } from '../movements/movement.mapper';
import { MovementsService } from '../movements/movements.service';
import { isPocketInProgress } from '../pockets/pocket.calculator';
import { PocketsRepository } from '../pockets/pockets.repository';
import { cutDateOf, historyMonths } from './dashboard.calculator';

/** Contrato §2, `Dashboard`. */
export interface DashboardDto {
  month: string;
  summary: {
    netWorth: number;
    freeBalance: number;
    pocketsBalance: number;
    pocketsInProgress: number;
    monthExpense: number;
    monthIncome: number;
  };
  credit: { used: number; limit: number };
  netWorthHistory: { month: string; netWorth: number }[];
  budgets: BudgetDto[];
  recentMovements: MovementDto[];
}

/**
 * Junta lo que calculan los demás módulos: el Dashboard no tiene fórmulas
 * propias, así que no puede decir un número distinto al de Mis Tarjetas,
 * Apartados o Piggy (requerimientos-backend.md §3).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly balancesService: BalancesService,
    private readonly budgetsService: BudgetsService,
    private readonly cardsRepository: CardsRepository,
    private readonly pocketsRepository: PocketsRepository,
    private readonly movementsService: MovementsService,
  ) {}

  async forMonth(user: AuthUser, month?: string): Promise<DashboardDto> {
    const today = todayIn(user.timeZone);
    const selected = month ?? monthOf(today);
    const cut = cutDateOf(selected, today);
    const months = historyMonths(
      selected,
      await this.balancesService.firstInitialBalanceDate(user.id),
    );
    const historyCuts = months.map((item) => cutDateOf(item, today));
    const dates = [...new Set([cut, ...historyCuts])];

    const [summaries, flows, creditCards, pockets, budgets, recentMovements] =
      await Promise.all([
        this.balancesService.summariesOn(user.id, dates),
        this.movementsService.flowTotals(
          user.id,
          firstDayOfMonth(selected),
          cut,
        ),
        this.cardsRepository.findForUser(user.id, {
          type: CARD_TYPE_DB[CardType.CREDIT],
          isActive: true,
        }),
        this.pocketsRepository.findForUser(user.id, true),
        this.budgetsService.listForMonth(user.id, selected),
        this.movementsService.recent(user.id, cut, 3),
      ]);
    const summaryOn = new Map(
      dates.map((date, index) => [date, summaries[index]]),
    );
    const current = summaryOn.get(cut);
    if (!current) {
      throw new Error(`No balance summary for ${cut}`);
    }

    return {
      month: selected,
      summary: {
        netWorth: fromCents(current.netWorthCents),
        freeBalance: fromCents(current.freeBalanceCents),
        pocketsBalance: fromCents(current.pocketsBalanceCents),
        pocketsInProgress: pockets.filter((pocket) =>
          isPocketInProgress({
            isActive: pocket.isActive,
            balanceCents: toCents(pocket.balance),
            targetCents:
              pocket.targetAmount === null
                ? null
                : toCents(pocket.targetAmount),
          }),
        ).length,
        monthExpense: fromCents(flows.expenseCents),
        monthIncome: fromCents(flows.incomeCents),
      },
      credit: {
        used: fromCents(current.creditUsedCents),
        limit: fromCents(
          creditCards.reduce(
            (total, card) => total + toCents(card.creditLimit ?? 0),
            0,
          ),
        ),
      },
      netWorthHistory: months.map((item, index) => ({
        month: item,
        netWorth: fromCents(
          summaryOn.get(historyCuts[index])?.netWorthCents ?? 0,
        ),
      })),
      budgets,
      recentMovements,
    };
  }
}
