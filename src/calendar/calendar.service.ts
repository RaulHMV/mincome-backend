import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import { CardsService } from '../cards/cards.service';
import {
  addDays,
  firstDayOfMonth,
  lastDayOfMonth,
  monthOf,
  todayIn,
} from '../common/dates';
import { CardType } from '../common/enums';
import { ValidationError } from '../common/errors/api-error';
import { toCents } from '../common/money';
import { RecurringTransactionsService } from '../recurring-transactions/recurring-transactions.service';
import {
  cardEvents,
  projectBalance,
  recurringEvents,
  sortEvents,
  type BalanceProjection,
  type CalendarEvent,
  type CreditCardSource,
  type RecurringSource,
} from './calendar.calculator';
import type { BalanceProjectionQuery } from './dto/calendar.dto';

/** Contrato §2, `Calendar`. */
export interface CalendarDto {
  month: string;
  events: CalendarEvent[];
}

/** Hasta un año: más allá, las recurrentes y los cortes dicen poco. */
const MAX_PROJECTION_DAYS = 366;

/**
 * Calendario y "Libre para gastar" (requerimientos-backend.md §3.8). Piggy
 * usa la misma proyección que el simulador, para dar el mismo número.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly recurringTransactionsService: RecurringTransactionsService,
    private readonly cardsService: CardsService,
    private readonly balancesService: BalancesService,
  ) {}

  async forMonth(user: AuthUser, month?: string): Promise<CalendarDto> {
    const selected = month ?? monthOf(todayIn(user.timeZone));
    return {
      month: selected,
      events: await this.eventsBetween(
        user,
        firstDayOfMonth(selected),
        lastDayOfMonth(selected),
      ),
    };
  }

  async projection(
    user: AuthUser,
    query: BalanceProjectionQuery,
  ): Promise<BalanceProjection> {
    const today = todayIn(user.timeZone);
    if (query.date < today) {
      throw ValidationError.forField(
        'date',
        'Debe ser hoy o una fecha futura: el Saldo Libre ya incluye lo que pasó',
      );
    }
    if (query.date > addDays(today, MAX_PROJECTION_DAYS)) {
      throw ValidationError.forField('date', 'Máximo un año a partir de hoy');
    }
    const [events, summary] = await Promise.all([
      this.eventsBetween(user, addDays(today, 1), query.date),
      this.balancesService.summaryOn(user.id, today),
    ]);
    return projectBalance({
      today,
      date: query.date,
      freeBalanceCents: summary.freeBalanceCents,
      events,
      extraIncomeCents: toCents(query.extraIncome),
      extraExpenseCents: toCents(query.extraExpense),
      dailySavingCents: toCents(query.dailySaving),
    });
  }

  private async eventsBetween(
    user: AuthUser,
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    if (from > to) {
      return [];
    }
    const [templates, cards] = await Promise.all([
      this.recurringTransactionsService.list(user, { isActive: true }),
      this.cardsService.list(user, { type: CardType.CREDIT, isActive: true }),
    ]);
    const recurring: RecurringSource[] = templates.map((template) => ({
      id: template.id,
      type: template.type,
      concept: template.concept,
      amountCents: toCents(template.amount),
      rule: {
        frequency: template.frequency,
        startDate: template.startDate,
        dayOfMonth: template.dayOfMonth,
        endDate: template.endDate,
      },
    }));
    const creditCards: CreditCardSource[] = cards.flatMap((card) =>
      card.cutoffDay === null || card.dueDay === null
        ? []
        : [
            {
              id: card.id,
              alias: card.alias,
              cutoffDay: card.cutoffDay,
              dueDay: card.dueDay,
              usedCreditCents: toCents(card.usedCredit ?? 0),
              paymentToAvoidInterestCents: toCents(
                card.paymentToAvoidInterest ?? 0,
              ),
            },
          ],
    );
    return sortEvents([
      ...recurringEvents(recurring, from, to),
      ...cardEvents(creditCards, from, to, todayIn(user.timeZone)),
    ]);
  }
}
