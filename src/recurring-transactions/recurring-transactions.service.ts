import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import { maxDate, todayIn } from '../common/dates';
import {
  FLOW_SUBTYPE_DB,
  FLOW_TYPE_DB,
  Frequency,
  FREQUENCY_DB,
  fromDb,
  PAYMENT_METHOD_DB,
  PaymentMethod,
} from '../common/enums';
import { NotFoundError, ValidationError } from '../common/errors/api-error';
import { centsToNumeric, toCents } from '../common/money';
import {
  toTransactionDto,
  type TransactionDto,
} from '../transactions/transaction.mapper';
import {
  assertSubtypeMatches,
  PaymentSourceResolver,
} from '../transactions/payment-source.resolver';
import { TransactionsRepository } from '../transactions/transactions.repository';
import { TransactionsService } from '../transactions/transactions.service';
import type {
  CreateRecurringTransactionDto,
  ListRecurringTransactionsQuery,
  UpdateRecurringTransactionDto,
} from './dto/recurring-transaction.dto';
import {
  firstOccurrenceOnOrAfter,
  nextOccurrence,
  type RecurrenceRule,
} from './recurrence';
import type { RecurringTransaction } from './recurring-transaction.entity';
import {
  toRecurringTransactionDto,
  type RecurringTransactionDto,
} from './recurring-transaction.mapper';
import { RecurringTransactionsRepository } from './recurring-transactions.repository';

/** Tope de ocurrencias por plantilla en una corrida; las demás salen en la siguiente. */
const MAX_OCCURRENCES_PER_RUN = 1000;
const DUE_BATCH_SIZE = 100;

export interface CreateRecurringTransactionResult {
  recurringTransaction: RecurringTransactionDto;
  generatedTransactions: TransactionDto[];
}

export interface RecurringRunSummary {
  templates: number;
  transactions: number;
  failures: number;
}

export function ruleOf(template: RecurringTransaction): RecurrenceRule {
  return {
    frequency: fromDb(FREQUENCY_DB, template.frequency),
    startDate: template.startDate,
    dayOfMonth: template.dayOfMonth,
    endDate: template.endDate,
  };
}

@Injectable()
export class RecurringTransactionsService {
  private readonly logger = new Logger(RecurringTransactionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly recurringTransactionsRepository: RecurringTransactionsRepository,
    private readonly transactionsService: TransactionsService,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly paymentSourceResolver: PaymentSourceResolver,
    private readonly categoriesService: CategoriesService,
  ) {}

  async list(
    user: AuthUser,
    query: ListRecurringTransactionsQuery,
  ): Promise<RecurringTransactionDto[]> {
    const rows = await this.recurringTransactionsRepository.findViews(
      user.id,
      query.isActive ?? null,
    );
    return rows.map((row) => toRecurringTransactionDto(row, user.timeZone));
  }

  /**
   * Crea la plantilla y, si su inicio ya llegó, genera en ese momento las
   * ocurrencias que tocaban (requerimientos-backend.md §3.7).
   */
  async create(
    user: AuthUser,
    dto: CreateRecurringTransactionDto,
  ): Promise<CreateRecurringTransactionResult> {
    assertSubtypeMatches(dto.type, dto.subtype, { recurring: true });
    await this.categoriesService.requireUsable(
      this.dataSource.manager,
      user.id,
      dto.categoryId,
      dto.type,
    );
    const rule: RecurrenceRule = {
      frequency: dto.frequency,
      startDate: dto.startDate,
      dayOfMonth: dto.dayOfMonth,
      endDate: dto.endDate,
    };
    const nextRunDate = firstOccurrenceOnOrAfter(rule, dto.startDate);
    if (nextRunDate === null) {
      throw ValidationError.forField(
        'endDate',
        'No hay ninguna ocurrencia entre el inicio y el fin',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const source = await this.paymentSourceResolver.resolve(
        manager,
        user.id,
        dto.type,
        dto,
      );
      const id = await this.recurringTransactionsRepository.insert(manager, {
        userId: user.id,
        categoryId: dto.categoryId,
        accountId: source.account.id,
        cardId: source.cardId,
        type: FLOW_TYPE_DB[dto.type],
        subtype: FLOW_SUBTYPE_DB[dto.subtype],
        amount: centsToNumeric(toCents(dto.amount)),
        concept: dto.concept,
        paymentMethod: PAYMENT_METHOD_DB[dto.paymentMethod],
        frequency: FREQUENCY_DB[dto.frequency],
        dayOfMonth: dto.dayOfMonth,
        startDate: dto.startDate,
        endDate: dto.endDate,
        nextRunDate,
        isActive: true,
      });
      const generatedIds = await this.generateDueFor(
        manager,
        id,
        todayIn(user.timeZone),
      );
      const view = await this.recurringTransactionsRepository.findView(
        user.id,
        id,
        manager,
      );
      if (!view) {
        throw new NotFoundError();
      }
      const generated = await this.transactionsRepository.findViews(
        user.id,
        generatedIds,
        manager,
      );
      return {
        recurringTransaction: toRecurringTransactionDto(view, user.timeZone),
        generatedTransactions: generated.map((row) =>
          toTransactionDto(row, user.timeZone),
        ),
      };
    });
  }

  /**
   * Pausar (isActive: false), terminar (endDate) o editar. Las recurrentes no
   * se borran porque sus transacciones las referencian (contrato §3.3).
   */
  async update(
    user: AuthUser,
    recurringTransactionId: string,
    dto: UpdateRecurringTransactionDto,
  ): Promise<RecurringTransactionDto> {
    const today = todayIn(user.timeZone);
    await this.dataSource.transaction(async (manager) => {
      const existing = await this.recurringTransactionsRepository.findForUpdate(
        manager,
        recurringTransactionId,
        user.id,
      );
      if (!existing) {
        throw new NotFoundError();
      }
      const rule = { ...ruleOf(existing) };
      if (dto.dayOfMonth !== undefined) {
        if (rule.frequency !== Frequency.MONTHLY) {
          throw ValidationError.forField(
            'dayOfMonth',
            'Solo aplica en monthly',
          );
        }
        rule.dayOfMonth = dto.dayOfMonth;
      }
      if (dto.endDate !== undefined) {
        if (dto.endDate !== null && dto.endDate < rule.startDate) {
          throw ValidationError.forField(
            'endDate',
            'Debe ser igual o posterior al inicio',
          );
        }
        rule.endDate = dto.endDate;
      }

      const type = fromDb(FLOW_TYPE_DB, existing.type);
      const subtype = dto.subtype ?? fromDb(FLOW_SUBTYPE_DB, existing.subtype);
      assertSubtypeMatches(type, subtype, { recurring: true });
      if (dto.categoryId !== undefined) {
        await this.categoriesService.requireUsable(
          manager,
          user.id,
          dto.categoryId,
          type,
        );
      }
      const changesSource =
        dto.paymentMethod !== undefined ||
        dto.cardId !== undefined ||
        dto.accountId !== undefined;
      let source: { accountId: string; cardId: string | null } = {
        accountId: existing.accountId,
        cardId: existing.cardId,
      };
      if (changesSource) {
        const existingMethod = fromDb(
          PAYMENT_METHOD_DB,
          existing.paymentMethod,
        );
        const paymentMethod = dto.paymentMethod ?? existingMethod;
        const keepsSource = paymentMethod === existingMethod;
        const resolved = await this.paymentSourceResolver.resolve(
          manager,
          user.id,
          type,
          {
            paymentMethod,
            cardId:
              dto.cardId !== undefined
                ? dto.cardId
                : keepsSource
                  ? existing.cardId
                  : null,
            accountId:
              dto.accountId !== undefined
                ? dto.accountId
                : keepsSource && paymentMethod !== PaymentMethod.CARD
                  ? existing.accountId
                  : null,
          },
        );
        source = { accountId: resolved.account.id, cardId: resolved.cardId };
      }

      // Pausada no tiene siguiente ocurrencia. Activa, la siguiente se calcula
      // desde hoy si cambió la regla o vuelve de una pausa.
      const isActive = dto.isActive ?? existing.isActive;
      let nextRunDate: string | null = null;
      if (isActive) {
        const recalculate =
          dto.dayOfMonth !== undefined ||
          dto.endDate !== undefined ||
          !existing.isActive;
        nextRunDate =
          recalculate || existing.nextRunDate === null
            ? firstOccurrenceOnOrAfter(rule, maxDate(rule.startDate, today))
            : existing.nextRunDate;
        if (nextRunDate === null && dto.isActive === true) {
          throw ValidationError.forField(
            'isActive',
            'La recurrente ya terminó; cambia la fecha fin',
          );
        }
      }

      await this.recurringTransactionsRepository.update(manager, existing.id, {
        subtype: FLOW_SUBTYPE_DB[subtype],
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.amount !== undefined
          ? { amount: centsToNumeric(toCents(dto.amount)) }
          : {}),
        ...(dto.concept !== undefined ? { concept: dto.concept } : {}),
        ...(dto.paymentMethod !== undefined
          ? { paymentMethod: PAYMENT_METHOD_DB[dto.paymentMethod] }
          : {}),
        accountId: source.accountId,
        cardId: source.cardId,
        dayOfMonth: rule.dayOfMonth,
        endDate: rule.endDate,
        nextRunDate,
        isActive: nextRunDate !== null,
      });
      if (nextRunDate !== null) {
        await this.generateDueFor(manager, existing.id, today);
      }
    });

    const view = await this.recurringTransactionsRepository.findView(
      user.id,
      recurringTransactionId,
    );
    if (!view) {
      throw new NotFoundError();
    }
    return toRecurringTransactionDto(view, user.timeZone);
  }

  /**
   * El proceso diario (EventBridge en AWS): genera lo que ya tocaba en todas
   * las plantillas activas. Cada plantilla va en su propia transacción; si
   * una falla, se registra y sigue con las demás. Correrlo dos veces no
   * duplica nada (índice único recurrente_id + fecha).
   */
  async generateAllDue(): Promise<RecurringRunSummary> {
    const summary: RecurringRunSummary = {
      templates: 0,
      transactions: 0,
      failures: 0,
    };
    const attempted: string[] = [];
    for (;;) {
      const due = await this.recurringTransactionsRepository.findDue(
        DUE_BATCH_SIZE,
        attempted,
      );
      if (due.length === 0) {
        return summary;
      }
      for (const template of due) {
        attempted.push(template.id);
        try {
          const generated = await this.dataSource.transaction((manager) =>
            this.generateDueFor(
              manager,
              template.id,
              todayIn(template.timeZone),
            ),
          );
          summary.templates += 1;
          summary.transactions += generated.length;
        } catch (error) {
          summary.failures += 1;
          this.logger.error(
            `Recurring transaction ${template.id} failed: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }
    }
  }

  /**
   * Inserta cada ocurrencia con proxima_ejecucion <= hoy, avanza la
   * siguiente con la regla de §2.4 y termina la plantilla si pasa de su
   * fecha fin. Regresa los id de las transacciones nuevas.
   */
  private async generateDueFor(
    manager: EntityManager,
    recurringTransactionId: string,
    today: string,
  ): Promise<string[]> {
    const template = await this.recurringTransactionsRepository.findForUpdate(
      manager,
      recurringTransactionId,
    );
    if (
      !template?.isActive ||
      template.nextRunDate === null ||
      template.nextRunDate > today
    ) {
      return [];
    }
    const rule = ruleOf(template);
    const generated: string[] = [];
    // Se normaliza a una ocurrencia real de la regla: con datos anteriores a
    // §2.4, proxima_ejecucion puede ser fecha_inicio aunque no caiga en el día.
    let next = firstOccurrenceOnOrAfter(rule, template.nextRunDate);
    for (
      let count = 0;
      next !== null && next <= today && count < MAX_OCCURRENCES_PER_RUN;
      count++
    ) {
      const id = await this.transactionsService.insertGenerated(manager, {
        userId: template.userId,
        categoryId: template.categoryId,
        accountId: template.accountId,
        cardId: template.cardId,
        recurringTransactionId: template.id,
        type: template.type,
        subtype: template.subtype,
        amount: template.amount,
        date: next,
        concept: template.concept,
        paymentMethod: template.paymentMethod,
      });
      if (id) {
        generated.push(id);
      }
      next = nextOccurrence(rule, next);
    }
    await this.recurringTransactionsRepository.update(manager, template.id, {
      nextRunDate: next,
      isActive: next !== null,
    });
    return generated;
  }
}
