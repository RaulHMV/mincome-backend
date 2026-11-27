import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { ACCOUNT_TYPE_DB } from '../common/enums';
import { fromCents } from '../common/money';
import type { SearchMovementsQuery } from './dto/movement.dto';
import {
  toMovementDto,
  type MovementDto,
  type MovementPage,
} from './movement.mapper';
import {
  MovementsRepository,
  type MovementFilters,
} from './movements.repository';

/**
 * Movimientos, Historial y "Últimos movimientos" del Dashboard leen de aquí;
 * Piggy también, con search_movements (requerimientos-ia.md).
 */
@Injectable()
export class MovementsService {
  constructor(private readonly movementsRepository: MovementsRepository) {}

  async search(
    user: AuthUser,
    query: SearchMovementsQuery,
  ): Promise<MovementPage> {
    const filters: MovementFilters = {
      kinds: query.kind ?? null,
      from: query.from,
      to: query.to,
      q: query.q,
      categoryId: query.categoryId,
      accountType: query.accountType && ACCOUNT_TYPE_DB[query.accountType],
      accountId: query.accountId,
      cardId: query.cardId,
      minAmount: query.minAmount,
      maxAmount: query.maxAmount,
    };
    const page = { page: query.page, pageSize: query.pageSize };
    const [rows, totals] = await Promise.all([
      this.movementsRepository.findPage(user.id, filters, page),
      this.movementsRepository.totals(user.id, filters),
    ]);
    return {
      items: rows.map(toMovementDto),
      page: page.page,
      pageSize: page.pageSize,
      total: totals.total,
      summary: {
        income: fromCents(totals.incomeCents),
        expense: fromCents(totals.expenseCents),
        pocketDeposits: fromCents(totals.pocketDepositsCents),
        pocketWithdrawals: fromCents(totals.pocketWithdrawalsCents),
        balance: fromCents(totals.incomeCents - totals.expenseCents),
      },
    };
  }

  /** Los más recientes hasta `until`, inclusive. */
  async recent(
    userId: string,
    until: string,
    limit: number,
  ): Promise<MovementDto[]> {
    const rows = await this.movementsRepository.findPage(
      userId,
      { kinds: null, to: until },
      { page: 1, pageSize: limit },
    );
    return rows.map(toMovementDto);
  }
}
