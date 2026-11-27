import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import type { BudgetDto } from '../budgets/budget.mapper';
import { BudgetsService } from '../budgets/budgets.service';
import { CategoriesService } from '../categories/categories.service';
import { formatTimestamp, todayIn } from '../common/dates';
import {
  ALERT_LEVEL_DB,
  AlertLevel,
  FLOW_SUBTYPE_DB,
  FLOW_TYPE_DB,
  FlowSubtype,
  FlowType,
  fromDb,
  PAYMENT_METHOD_DB,
  PaymentMethod,
} from '../common/enums';
import { NotFoundError, ValidationError } from '../common/errors/api-error';
import { centsToNumeric, fromCents, toCents } from '../common/money';
import { toAccountSummary, toCardSummary } from '../common/summaries';
import type {
  CreateTransactionDto,
  UpdateTransactionDto,
} from './dto/transaction.dto';
import {
  assertSubtypeMatches,
  PaymentSourceResolver,
  type ResolvedPaymentSource,
} from './payment-source.resolver';
import type { Transaction } from './transaction.entity';
import { toTransactionDto, type TransactionDto } from './transaction.mapper';
import {
  TransactionsRepository,
  type GeneratedTransaction,
} from './transactions.repository';

/** La respuesta de POST y PATCH /transactions (excepción del contrato §3.3). */
export interface TransactionWriteResult {
  transaction: TransactionDto;
  /** El presupuesto de la categoría en el mes del gasto, para avisar en el momento. */
  budget: BudgetDto | null;
}

interface TransactionDraft {
  type: FlowType;
  subtype: FlowSubtype;
  categoryId: number;
  amountCents: number;
  date: string;
  time: string | null;
  concept: string;
  merchant: string | null;
  notes: string | null;
  paymentMethod: PaymentMethod;
  cardId: string | null;
  accountId: string | null;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly paymentSourceResolver: PaymentSourceResolver,
    private readonly categoriesService: CategoriesService,
    private readonly balancesService: BalancesService,
    private readonly budgetsService: BudgetsService,
  ) {}

  async findOne(
    user: AuthUser,
    transactionId: string,
  ): Promise<TransactionDto> {
    const view = await this.transactionsRepository.findView(
      user.id,
      transactionId,
    );
    if (!view) {
      throw new NotFoundError();
    }
    return toTransactionDto(view, user.timeZone);
  }

  /**
   * Registra un ingreso o un gasto. Con dryRun valida y calcula todo igual,
   * pero no guarda: lo usa Piggy para armar borradores (contrato §1).
   */
  async create(
    user: AuthUser,
    dto: CreateTransactionDto,
    { dryRun }: { dryRun: boolean },
  ): Promise<TransactionWriteResult> {
    const draft: TransactionDraft = {
      ...dto,
      amountCents: toCents(dto.amount),
    };
    return this.dataSource.transaction(async (manager) => {
      const { source, alertLevel } = await this.prepare(
        manager,
        user,
        draft,
        null,
      );
      if (dryRun) {
        return this.preview(manager, user, draft, source, alertLevel);
      }
      const transactionId = await this.transactionsRepository.insert(manager, {
        ...this.toColumns(user.id, draft, source),
        alertLevel: ALERT_LEVEL_DB[alertLevel],
      });
      return this.writeResult(manager, user, transactionId, draft);
    });
  }

  /**
   * Edita una transacción. Como los saldos se calculan, no hay nada que
   * revertir; se recalcula su nivel_alerta (requerimientos-backend.md §3.6).
   */
  async update(
    user: AuthUser,
    transactionId: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionWriteResult> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await this.transactionsRepository.findOwnedForUpdate(
        manager,
        user.id,
        transactionId,
      );
      if (!existing) {
        throw new NotFoundError();
      }
      const draft = mergeDraft(existing, dto);
      const { source, alertLevel } = await this.prepare(
        manager,
        user,
        draft,
        existing,
      );
      await this.transactionsRepository.update(manager, transactionId, {
        ...this.toColumns(user.id, draft, source),
        alertLevel: ALERT_LEVEL_DB[alertLevel],
      });
      return this.writeResult(manager, user, transactionId, draft);
    });
  }

  async remove(user: AuthUser, transactionId: string): Promise<void> {
    if (!(await this.transactionsRepository.delete(user.id, transactionId))) {
      throw new NotFoundError();
    }
  }

  /**
   * Una ocurrencia de una recurrente (requerimientos-backend.md §3.7). La
   * plantilla ya se validó al crearse, y no se bloquea por saldo: es un
   * compromiso programado que el usuario puede editar o borrar. null si esa
   * ocurrencia ya existía.
   */
  async insertGenerated(
    manager: EntityManager,
    transaction: Omit<GeneratedTransaction, 'alertLevel'>,
  ): Promise<string | null> {
    const alertLevel =
      transaction.type === FLOW_TYPE_DB[FlowType.EXPENSE]
        ? await this.budgetsService.crossedLevel(manager, transaction.userId, {
            categoryId: transaction.categoryId,
            date: transaction.date,
            amountCents: toCents(transaction.amount),
          })
        : AlertLevel.NONE;
    return this.transactionsRepository.insertIfAbsent(manager, {
      ...transaction,
      alertLevel: ALERT_LEVEL_DB[alertLevel],
    });
  }

  /** Las validaciones que las FK no cubren (requerimientos-backend.md §4), el disponible (D14) y el nivel_alerta (§3.3). */
  private async prepare(
    manager: EntityManager,
    user: AuthUser,
    draft: TransactionDraft,
    existing: Transaction | null,
  ): Promise<{ source: ResolvedPaymentSource; alertLevel: AlertLevel }> {
    const today = todayIn(user.timeZone);
    assertSubtypeMatches(draft.type, draft.subtype, { recurring: false });
    if (draft.date > today) {
      throw ValidationError.forField(
        'date',
        'No puede ser una fecha futura; programa lo que viene como recurrente',
      );
    }
    await this.categoriesService.requireUsable(
      manager,
      user.id,
      draft.categoryId,
      draft.type,
    );
    const source = await this.paymentSourceResolver.resolve(
      manager,
      user.id,
      draft.type,
      draft,
    );

    const isExpense = draft.type === FlowType.EXPENSE;
    await this.balancesService.lockAccounts(manager, [
      source.account.id,
      ...(existing ? [existing.accountId] : []),
    ]);
    if (isExpense) {
      await this.balancesService.assertCanSpend(manager, user.id, {
        account: source.account,
        amountCents: draft.amountCents,
        date: draft.date,
        today,
        excludeTransactionId: existing?.id,
        field: 'amount',
      });
    }
    const alertLevel = isExpense
      ? await this.budgetsService.crossedLevel(manager, user.id, {
          categoryId: draft.categoryId,
          date: draft.date,
          amountCents: draft.amountCents,
          excludeTransactionId: existing?.id,
        })
      : AlertLevel.NONE;
    return { source, alertLevel };
  }

  private toColumns(
    userId: string,
    draft: TransactionDraft,
    source: ResolvedPaymentSource,
  ): Partial<Transaction> {
    return {
      userId,
      categoryId: draft.categoryId,
      accountId: source.account.id,
      cardId: source.cardId,
      type: FLOW_TYPE_DB[draft.type],
      subtype: FLOW_SUBTYPE_DB[draft.subtype],
      amount: centsToNumeric(draft.amountCents),
      date: draft.date,
      time: draft.time,
      concept: draft.concept,
      merchant: draft.merchant,
      notes: draft.notes,
      paymentMethod: PAYMENT_METHOD_DB[draft.paymentMethod],
    };
  }

  private async writeResult(
    manager: EntityManager,
    user: AuthUser,
    transactionId: string,
    draft: TransactionDraft,
  ): Promise<TransactionWriteResult> {
    const view = await this.transactionsRepository.findView(
      user.id,
      transactionId,
      manager,
    );
    if (!view) {
      throw new NotFoundError();
    }
    return {
      transaction: toTransactionDto(view, user.timeZone),
      budget:
        draft.type === FlowType.EXPENSE
          ? await this.budgetsService.forCategory(
              manager,
              user.id,
              draft.categoryId,
              draft.date,
            )
          : null,
    };
  }

  /** ?dryRun=true: la transacción como quedaría, con id en null, y cómo quedaría el presupuesto. */
  private async preview(
    manager: EntityManager,
    user: AuthUser,
    draft: TransactionDraft,
    source: ResolvedPaymentSource,
    alertLevel: AlertLevel,
  ): Promise<TransactionWriteResult> {
    const category = await this.categoriesService.requireUsable(
      manager,
      user.id,
      draft.categoryId,
      draft.type,
    );
    const cards: {
      id: string;
      alias: string;
      last4: string | null;
      type: string;
    }[] = source.cardId
      ? await manager.query(
          `SELECT id, alias, terminacion AS last4, tipo_tarjeta AS type FROM tarjetas WHERE id = $1`,
          [source.cardId],
        )
      : [];
    const now = formatTimestamp(new Date(), user.timeZone);
    const isExpense = draft.type === FlowType.EXPENSE;
    return {
      transaction: {
        id: null,
        date: draft.date,
        time: draft.time,
        type: draft.type,
        subtype: draft.subtype,
        amount: fromCents(draft.amountCents),
        concept: draft.concept,
        merchant: draft.merchant,
        notes: draft.notes,
        paymentMethod: draft.paymentMethod,
        category: { id: category.id, name: category.name, icon: category.icon },
        account: toAccountSummary(source.account),
        card: cards[0] ? toCardSummary(cards[0]) : null,
        recurringTransactionId: null,
        alertLevel,
        createdAt: now,
        updatedAt: now,
      },
      budget: isExpense
        ? await this.budgetsService.forCategory(
            manager,
            user.id,
            draft.categoryId,
            draft.date,
            draft.amountCents,
          )
        : null,
    };
  }
}

/**
 * PATCH lleva solo lo que cambia. Si cambia el método de pago, la tarjeta y
 * la cuenta anteriores ya no aplican: con tarjeta la cuenta sale de ella, y
 * sin tarjeta hay que indicar la cuenta.
 */
function mergeDraft(
  existing: Transaction,
  dto: UpdateTransactionDto,
): TransactionDraft {
  const existingMethod = fromDb(PAYMENT_METHOD_DB, existing.paymentMethod);
  const paymentMethod = dto.paymentMethod ?? existingMethod;
  const keepsSource = paymentMethod === existingMethod;
  return {
    type: dto.type ?? fromDb(FLOW_TYPE_DB, existing.type),
    subtype: dto.subtype ?? fromDb(FLOW_SUBTYPE_DB, existing.subtype),
    categoryId: dto.categoryId ?? existing.categoryId,
    amountCents:
      dto.amount !== undefined ? toCents(dto.amount) : toCents(existing.amount),
    date: dto.date ?? existing.date,
    time:
      dto.time !== undefined
        ? dto.time
        : existing.time === null
          ? null
          : existing.time.slice(0, 5),
    concept: dto.concept ?? existing.concept,
    merchant: dto.merchant !== undefined ? dto.merchant : existing.merchant,
    notes: dto.notes !== undefined ? dto.notes : existing.notes,
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
  };
}
