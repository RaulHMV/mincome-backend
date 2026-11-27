import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { BudgetsService } from '../budgets/budgets.service';
import { CardsService } from '../cards/cards.service';
import { monthOf, todayIn } from '../common/dates';
import { CardType } from '../common/enums';
import { NotFoundError } from '../common/errors/api-error';
import { PocketsRepository } from '../pockets/pockets.repository';
import {
  budgetAlert,
  cardPaymentAlert,
  pocketGoalAlert,
  readSignature,
  sortAlerts,
  type AlertDto,
} from './alert.calculator';
import { AlertsRepository } from './alerts.repository';

/** La campana del header (requerimientos-backend.md §3.9). */
@Injectable()
export class AlertsService {
  constructor(
    private readonly budgetsService: BudgetsService,
    private readonly cardsService: CardsService,
    private readonly pocketsRepository: PocketsRepository,
    private readonly alertsRepository: AlertsRepository,
  ) {}

  async list(user: AuthUser): Promise<AlertDto[]> {
    const alerts = await this.current(user);
    const reads = await this.alertsRepository.findReads(
      user.id,
      alerts.map((alert) => alert.id),
    );
    return alerts.map((alert) => {
      const read = reads.get(alert.id);
      return {
        ...alert,
        isRead: read?.readAt != null && read.signature === readSignature(alert),
      };
    });
  }

  /** Solo se puede marcar una alerta que sigue vigente; si no, 404. */
  async update(
    user: AuthUser,
    alertId: string,
    isRead: boolean,
  ): Promise<AlertDto> {
    const alert = (await this.current(user)).find(
      (candidate) => candidate.id === alertId,
    );
    if (!alert) {
      throw new NotFoundError();
    }
    await this.alertsRepository.saveRead(
      user.id,
      alert,
      readSignature(alert),
      isRead,
    );
    return { ...alert, isRead };
  }

  private async current(user: AuthUser): Promise<AlertDto[]> {
    const today = todayIn(user.timeZone);
    const month = monthOf(today);
    const [budgets, cards, pockets] = await Promise.all([
      this.budgetsService.listForMonth(user.id, month),
      this.cardsService.list(user, { type: CardType.CREDIT, isActive: true }),
      this.pocketsRepository.findForUser(user.id, true),
    ]);
    return sortAlerts(
      [
        ...budgets.map((budget) => budgetAlert(budget, month)),
        ...cards.map((card) => cardPaymentAlert(card, today)),
        ...pockets.map((pocket) => pocketGoalAlert(pocket, today)),
      ].filter((alert): alert is AlertDto => alert !== null),
    );
  }
}
