import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Account } from '../accounts/account.entity';
import { AccountsRepository } from '../accounts/accounts.repository';
import { AccountsService } from '../accounts/accounts.service';
import { CardsService } from '../cards/cards.service';
import {
  ACCOUNT_TYPE_DB,
  AccountType,
  FlowSubtype,
  FlowType,
  PaymentMethod,
} from '../common/enums';
import { ValidationError } from '../common/errors/api-error';

export interface PaymentSource {
  paymentMethod: PaymentMethod;
  cardId: string | null;
  accountId: string | null;
}

export interface ResolvedPaymentSource {
  account: Account;
  cardId: string | null;
}

/** Subtipos válidos por flujo (decisión D3). En recurrentes nunca 'variable'. */
const SUBTYPES: Record<FlowType, FlowSubtype[]> = {
  [FlowType.INCOME]: [FlowSubtype.RECURRING, FlowSubtype.VARIABLE],
  [FlowType.EXPENSE]: [FlowSubtype.FIXED, FlowSubtype.VARIABLE],
};

export function assertSubtypeMatches(
  type: FlowType,
  subtype: FlowSubtype,
  { recurring }: { recurring: boolean },
): void {
  const allowed = SUBTYPES[type].filter(
    (candidate) => !recurring || candidate !== FlowSubtype.VARIABLE,
  );
  if (!allowed.includes(subtype)) {
    throw ValidationError.forField(
      'subtype',
      `Con ${type === FlowType.INCOME ? 'un ingreso' : 'un gasto'} usa ${allowed.join(' o ')}`,
    );
  }
}

/**
 * De qué cuenta sale o a qué cuenta entra el dinero (requerimientos-backend.md
 * §3.6 y §4): con tarjeta, la cuenta es la de la tarjeta; en efectivo, una
 * cuenta de efectivo; por transferencia, una de débito. Un ingreso solo
 * entra a efectivo o débito.
 */
@Injectable()
export class PaymentSourceResolver {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly accountsRepository: AccountsRepository,
    private readonly cardsService: CardsService,
  ) {}

  async resolve(
    manager: EntityManager,
    userId: string,
    type: FlowType,
    source: PaymentSource,
  ): Promise<ResolvedPaymentSource> {
    if (source.paymentMethod === PaymentMethod.CARD) {
      if (type === FlowType.INCOME) {
        throw ValidationError.forField(
          'paymentMethod',
          'Un ingreso entra en efectivo o a una cuenta de débito',
        );
      }
      if (!source.cardId) {
        throw ValidationError.forField(
          'cardId',
          'Obligatoria si el método de pago es tarjeta',
        );
      }
      const card = await this.cardsService.requireUsable(
        manager,
        userId,
        source.cardId,
      );
      if (source.accountId && source.accountId !== card.accountId) {
        throw ValidationError.forField(
          'accountId',
          'Con tarjeta, la cuenta sale de la tarjeta',
        );
      }
      const account = await this.accountsRepository.findOwned(
        userId,
        card.accountId,
        manager,
      );
      if (!account?.isActive) {
        throw ValidationError.forField(
          'cardId',
          'La cuenta de la tarjeta está desactivada',
        );
      }
      return { account, cardId: card.id };
    }

    if (source.cardId) {
      throw ValidationError.forField(
        'cardId',
        'Solo va si el método de pago es tarjeta',
      );
    }
    if (!source.accountId) {
      throw ValidationError.forField(
        'accountId',
        'Obligatoria con efectivo o transferencia',
      );
    }
    const account = await this.accountsService.requireUsable(
      manager,
      userId,
      source.accountId,
      {
        types: [
          source.paymentMethod === PaymentMethod.CASH
            ? ACCOUNT_TYPE_DB[AccountType.CASH]
            : ACCOUNT_TYPE_DB[AccountType.DEBIT],
        ],
        field: 'accountId',
      },
    );
    return { account, cardId: null };
  }
}
