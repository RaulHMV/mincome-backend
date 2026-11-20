import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccountsRepository } from '../accounts/accounts.repository';
import { AccountsService } from '../accounts/accounts.service';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import { todayIn } from '../common/dates';
import {
  ACCOUNT_TYPE_DB,
  AccountType,
  CARD_TYPE_DB,
  CardType,
} from '../common/enums';
import {
  ConflictError,
  InsufficientFundsError,
  NotFoundError,
  ValidationError,
  type FieldErrors,
} from '../common/errors/api-error';
import { centsToNumeric, toCents } from '../common/money';
import {
  availableCreditCents,
  nextDateOfDay,
  paymentToAvoidInterestCents,
  previousDateOfDay,
} from './card.calculator';
import {
  toCardDto,
  toTransferDto,
  type CardDto,
  type CreditStatus,
  type TransferDto,
} from './card.mapper';
import { CardsRepository, type CardRow } from './cards.repository';
import type {
  CreateCardDto,
  ListCardsQuery,
  PayCardDto,
  UpdateCardDto,
} from './dto/card.dto';

const CREDIT = CARD_TYPE_DB[CardType.CREDIT];

export interface CardComputed {
  credit: CreditStatus | null;
  balanceCents: number | null;
}

@Injectable()
export class CardsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cardsRepository: CardsRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly accountsService: AccountsService,
    private readonly balancesService: BalancesService,
  ) {}

  async list(user: AuthUser, query: ListCardsQuery): Promise<CardDto[]> {
    const cards = await this.cardsRepository.findForUser(user.id, {
      type: query.type ? CARD_TYPE_DB[query.type] : null,
      isActive: query.isActive ?? null,
    });
    return this.toDtos(user, cards);
  }

  async findOne(user: AuthUser, cardId: string): Promise<CardDto> {
    const card = await this.cardsRepository.findOwned(user.id, cardId);
    if (!card) {
      throw new NotFoundError();
    }
    const [dto] = await this.toDtos(user, [card]);
    return dto;
  }

  /**
   * Deuda, disponible, próximos corte y pago, y el pago para no generar
   * intereses de cada tarjeta (requerimientos-backend.md §3.5). En débito,
   * solo el saldo de su cuenta.
   */
  async computeStatuses(
    user: AuthUser,
    cards: CardRow[],
  ): Promise<Map<string, CardComputed>> {
    const today = todayIn(user.timeZone);
    const creditCards = cards.filter((card) => card.type === CREDIT);
    const lastCutoffs = new Map(
      creditCards.map((card) => [
        card.id,
        previousDateOfDay(today, card.cutoffDay ?? 1),
      ]),
    );
    const [balanceAt, payments] = await Promise.all([
      this.balancesService.accountBalancesAt(
        user.id,
        [today, ...new Set(lastCutoffs.values())],
        {
          accountIds: [...new Set(cards.map((card) => card.accountId))],
        },
      ),
      this.cardsRepository.paymentsSince(
        creditCards.map((card) => ({
          accountId: card.accountId,
          cutoffDate: lastCutoffs.get(card.id) ?? today,
        })),
      ),
    ]);

    return new Map(
      cards.map((card): [string, CardComputed] => {
        // Antes de su saldo inicial, la cuenta solo tiene ese saldo inicial.
        const initialCents = toCents(card.accountInitialBalance);
        const balanceTodayCents =
          balanceAt(today, card.accountId) ?? initialCents;
        if (card.type !== CREDIT) {
          return [card.id, { credit: null, balanceCents: balanceTodayCents }];
        }
        const lastCutoff = lastCutoffs.get(card.id) ?? today;
        const debtAtCutoffCents = Math.max(
          0,
          0 - (balanceAt(lastCutoff, card.accountId) ?? initialCents),
        );
        const usedCreditCents = 0 - balanceTodayCents;
        return [
          card.id,
          {
            balanceCents: null,
            credit: {
              usedCreditCents,
              availableCreditCents: availableCreditCents(
                toCents(card.creditLimit ?? 0),
                usedCreditCents,
              ),
              nextCutoffDate: nextDateOfDay(today, card.cutoffDay ?? 1),
              nextDueDate: nextDateOfDay(today, card.dueDay ?? 1),
              paymentToAvoidInterestCents: Math.min(
                paymentToAvoidInterestCents(
                  debtAtCutoffCents,
                  payments.get(card.accountId) ?? 0,
                ),
                Math.max(usedCreditCents, 0),
              ),
            },
          },
        ];
      }),
    );
  }

  async create(user: AuthUser, dto: CreateCardDto): Promise<CardDto> {
    const today = todayIn(user.timeZone);
    const cardId = await this.dataSource.transaction(async (manager) => {
      await this.assertNoConflicts(manager, user.id, dto, null);

      let accountId: string;
      if (dto.type === CardType.CREDIT) {
        // Cada tarjeta de crédito tiene su propia cuenta, con su alias y la deuda inicial.
        await this.assertAccountNameFree(manager, user.id, dto.alias, null);
        accountId = await this.accountsRepository.insert(manager, {
          userId: user.id,
          name: dto.alias,
          type: ACCOUNT_TYPE_DB[AccountType.CREDIT],
          initialBalance: centsToNumeric(0 - toCents(dto.initialDebt)),
          initialBalanceDate: today,
        });
      } else if (dto.accountId) {
        const account = await this.accountsService.requireUsable(
          manager,
          user.id,
          dto.accountId,
          {
            types: [ACCOUNT_TYPE_DB[AccountType.DEBIT]],
            field: 'accountId',
          },
        );
        accountId = account.id;
      } else {
        await this.assertAccountNameFree(manager, user.id, dto.alias, null);
        accountId = await this.accountsRepository.insert(manager, {
          userId: user.id,
          name: dto.alias,
          type: ACCOUNT_TYPE_DB[AccountType.DEBIT],
          initialBalance: centsToNumeric(toCents(dto.initialBalance ?? 0)),
          initialBalanceDate: today,
        });
      }

      return this.cardsRepository.insert(manager, {
        userId: user.id,
        accountId,
        alias: dto.alias,
        bank: dto.bank,
        last4: dto.last4,
        type: CARD_TYPE_DB[dto.type],
        colorHex: dto.colorHex,
        ...(dto.type === CardType.CREDIT
          ? {
              creditLimit: centsToNumeric(toCents(dto.creditLimit)),
              cutoffDay: dto.cutoffDay,
              dueDay: dto.dueDay,
            }
          : {}),
      });
    });
    return this.findOne(user, cardId);
  }

  async update(
    user: AuthUser,
    cardId: string,
    dto: UpdateCardDto,
  ): Promise<CardDto> {
    await this.dataSource.transaction(async (manager) => {
      const card = await this.requireOwned(manager, user.id, cardId);
      const isCredit = card.type === CREDIT;
      if (!isCredit) {
        const creditOnly: FieldErrors = {};
        for (const field of ['creditLimit', 'cutoffDay', 'dueDay'] as const) {
          if (dto[field] !== undefined) {
            creditOnly[field] = 'Solo aplica a tarjetas de crédito';
          }
        }
        if (Object.keys(creditOnly).length > 0) {
          throw new ValidationError(creditOnly);
        }
      }
      const cutoffDay = dto.cutoffDay ?? card.cutoffDay;
      const dueDay = dto.dueDay ?? card.dueDay;
      if (isCredit && cutoffDay === dueDay) {
        throw ValidationError.forField(
          'dueDay',
          'Debe ser distinto al día de corte',
        );
      }

      const alias = dto.alias ?? card.alias;
      const isActive = dto.isActive ?? card.isActive;
      const isReactivating = !card.isActive && dto.isActive === true;
      if (isActive && (isReactivating || dto.alias || dto.bank || dto.last4)) {
        await this.assertNoConflicts(
          manager,
          user.id,
          {
            alias,
            bank: dto.bank ?? card.bank,
            last4: dto.last4 ?? card.last4,
          },
          card.id,
        );
      }
      if (isReactivating && !isCredit && !card.accountIsActive) {
        throw new ConflictError('Activa primero la cuenta de esta tarjeta.');
      }
      if (isCredit && (alias !== card.alias || isReactivating) && isActive) {
        await this.assertAccountNameFree(
          manager,
          user.id,
          alias,
          card.accountId,
        );
      }

      await this.cardsRepository.update(manager, card.id, {
        ...(dto.alias !== undefined ? { alias: dto.alias } : {}),
        ...(dto.bank !== undefined ? { bank: dto.bank } : {}),
        ...(dto.last4 !== undefined ? { last4: dto.last4 } : {}),
        ...(dto.colorHex !== undefined ? { colorHex: dto.colorHex } : {}),
        ...(dto.creditLimit !== undefined
          ? { creditLimit: centsToNumeric(toCents(dto.creditLimit)) }
          : {}),
        ...(dto.cutoffDay !== undefined ? { cutoffDay: dto.cutoffDay } : {}),
        ...(dto.dueDay !== undefined ? { dueDay: dto.dueDay } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      if (isCredit) {
        // La cuenta de una tarjeta de crédito sigue a la tarjeta: nombre y estado.
        await this.accountsRepository.update(manager, card.accountId, {
          name: alias,
          isActive,
        });
      }
      if (card.isActive && dto.isActive === false) {
        await this.deactivateDependents(manager, card);
      }
    });
    return this.findOne(user, cardId);
  }

  /**
   * Si la tarjeta tiene movimientos, se desactiva para no romper el
   * historial; si no, se borra (decisión D16).
   */
  async remove(user: AuthUser, cardId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const card = await this.requireOwned(manager, user.id, cardId);
      if (await this.cardsRepository.hasHistory(manager, card)) {
        await this.cardsRepository.update(manager, card.id, {
          isActive: false,
        });
        if (card.type === CREDIT) {
          await this.accountsRepository.update(manager, card.accountId, {
            isActive: false,
          });
        }
        await this.deactivateDependents(manager, card);
        return;
      }
      await this.cardsRepository.delete(manager, card);
    });
  }

  /**
   * "Pagar tarjeta": un traspaso de efectivo o débito a la cuenta de la
   * tarjeta de crédito. No pasa de la deuda ni del saldo de la cuenta de
   * origen. Se permite pagar una tarjeta desactivada: la deuda sigue ahí.
   */
  async pay(
    user: AuthUser,
    cardId: string,
    dto: PayCardDto,
  ): Promise<TransferDto> {
    const today = todayIn(user.timeZone);
    const date = dto.date ?? today;
    if (date > today) {
      throw ValidationError.forField('date', 'No puede ser una fecha futura');
    }
    const amountCents = toCents(dto.amount);

    const transferId = await this.dataSource.transaction(async (manager) => {
      const card = await this.requireOwned(manager, user.id, cardId);
      if (card.type !== CREDIT) {
        throw new ValidationError(
          null,
          'Solo se pueden pagar tarjetas de crédito.',
        );
      }
      const source = await this.accountsService.requireLiquid(
        manager,
        user.id,
        dto.sourceAccountId,
        'sourceAccountId',
      );
      if (
        date < source.initialBalanceDate ||
        date < card.accountInitialBalanceDate
      ) {
        throw ValidationError.forField(
          'date',
          'Es anterior al saldo inicial de una de las cuentas',
        );
      }

      await this.balancesService.lockAccounts(manager, [
        source.id,
        card.accountId,
      ]);
      const debtCents =
        0 -
        (await this.balancesService.balanceCentsOf(
          manager,
          user.id,
          card.accountId,
          today,
        ));
      if (amountCents > debtCents) {
        throw new InsufficientFundsError(
          'El pago es mayor a la deuda de la tarjeta.',
          {
            amount: 'Es mayor a la deuda actual',
          },
        );
      }
      await this.balancesService.assertCanSpend(manager, user.id, {
        account: source,
        amountCents,
        date,
        today,
        field: 'amount',
      });

      return this.cardsRepository.insertTransfer(manager, {
        userId: user.id,
        sourceAccountId: source.id,
        destinationAccountId: card.accountId,
        amount: centsToNumeric(amountCents),
        date,
        note: dto.note,
      });
    });

    const transfer = await this.cardsRepository.findTransfer(
      user.id,
      transferId,
    );
    if (!transfer) {
      throw new NotFoundError();
    }
    return toTransferDto(transfer, user.timeZone);
  }

  /** Para un movimiento nuevo: tarjeta del usuario y activa (requerimientos-backend.md §4). */
  async requireUsable(
    manager: EntityManager,
    userId: string,
    cardId: string,
    field = 'cardId',
  ): Promise<CardRow> {
    const card = await this.cardsRepository.findOwned(userId, cardId, manager);
    if (!card) {
      throw ValidationError.forField(field, 'La tarjeta no existe');
    }
    if (!card.isActive) {
      throw ValidationError.forField(field, 'La tarjeta está desactivada');
    }
    return card;
  }

  private async toDtos(user: AuthUser, cards: CardRow[]): Promise<CardDto[]> {
    const statuses = await this.computeStatuses(user, cards);
    return cards.map((card) =>
      toCardDto(
        card,
        statuses.get(card.id) ?? { credit: null, balanceCents: null },
        user.timeZone,
      ),
    );
  }

  private async requireOwned(
    manager: EntityManager,
    userId: string,
    cardId: string,
  ): Promise<CardRow> {
    const card = await this.cardsRepository.findOwned(userId, cardId, manager);
    if (!card) {
      throw new NotFoundError();
    }
    return card;
  }

  private async deactivateDependents(
    manager: EntityManager,
    card: CardRow,
  ): Promise<void> {
    await this.cardsRepository.pauseRecurringTransactions(manager, card.id);
    if (card.type === CREDIT) {
      await this.accountsRepository.deactivateDependents(
        manager,
        card.accountId,
      );
    }
  }

  private async assertNoConflicts(
    manager: EntityManager,
    userId: string,
    card: { alias: string; bank: string | null; last4: string | null },
    exceptId: string | null,
  ): Promise<void> {
    const conflicts = await this.cardsRepository.findConflicts(
      manager,
      userId,
      card,
      exceptId,
    );
    const fields: FieldErrors = {};
    if (conflicts.alias) {
      fields.alias = 'Ya tienes una tarjeta activa con ese alias';
    }
    if (conflicts.bankAndLast4) {
      fields.last4 =
        'Ya tienes una tarjeta activa de ese banco con esa terminación';
    }
    if (Object.keys(fields).length > 0) {
      throw new ConflictError('La tarjeta ya está registrada.', fields);
    }
  }

  private async assertAccountNameFree(
    manager: EntityManager,
    userId: string,
    name: string,
    exceptAccountId: string | null,
  ): Promise<void> {
    if (
      await this.accountsRepository.isNameTaken(
        userId,
        name,
        exceptAccountId,
        manager,
      )
    ) {
      throw new ConflictError('Ya tienes una cuenta activa con ese nombre.', {
        alias: 'Ya existe una cuenta activa con ese nombre',
      });
    }
  }
}
