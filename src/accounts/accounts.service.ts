import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import { todayIn } from '../common/dates';
import {
  ACCOUNT_TYPE_DB,
  AccountType,
  type DbAccountType,
} from '../common/enums';
import {
  ConflictError,
  NotEditableError,
  NotFoundError,
  ValidationError,
} from '../common/errors/api-error';
import { centsToNumeric, toCents } from '../common/money';
import type { Account } from './account.entity';
import { toAccountDto, type AccountDto } from './account.mapper';
import { AccountsRepository } from './accounts.repository';
import type {
  CreateAccountDto,
  ListAccountsQuery,
  UpdateAccountDto,
} from './dto/account.dto';

const LIQUID_ACCOUNT_TYPES: DbAccountType[] = [
  ACCOUNT_TYPE_DB[AccountType.CASH],
  ACCOUNT_TYPE_DB[AccountType.DEBIT],
];

const NAME_CONFLICT = () =>
  new ConflictError('Ya tienes una cuenta activa con ese nombre.', {
    name: 'Ya existe una cuenta activa con ese nombre',
  });

@Injectable()
export class AccountsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accountsRepository: AccountsRepository,
    private readonly balancesService: BalancesService,
  ) {}

  async list(user: AuthUser, query: ListAccountsQuery): Promise<AccountDto[]> {
    const accounts = await this.accountsRepository.findForUser(
      user.id,
      query.includeInactive,
    );
    return this.toDtos(user, accounts);
  }

  async findOne(user: AuthUser, accountId: string): Promise<AccountDto> {
    const account = await this.accountsRepository.findOwned(user.id, accountId);
    if (!account) {
      throw new NotFoundError();
    }
    const [dto] = await this.toDtos(user, [account]);
    return dto;
  }

  async create(user: AuthUser, dto: CreateAccountDto): Promise<AccountDto> {
    const today = todayIn(user.timeZone);
    const initialBalanceDate = dto.initialBalanceDate ?? today;
    if (initialBalanceDate > today) {
      throw ValidationError.forField(
        'initialBalanceDate',
        'No puede ser una fecha futura',
      );
    }
    const accountId = await this.dataSource.transaction(async (manager) => {
      if (
        await this.accountsRepository.isNameTaken(
          user.id,
          dto.name,
          null,
          manager,
        )
      ) {
        throw NAME_CONFLICT();
      }
      return this.accountsRepository.insert(manager, {
        userId: user.id,
        name: dto.name,
        type: ACCOUNT_TYPE_DB[dto.type],
        initialBalance: centsToNumeric(toCents(dto.initialBalance)),
        initialBalanceDate,
      });
    });
    return this.findOne(user, accountId);
  }

  async update(
    user: AuthUser,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    const today = todayIn(user.timeZone);
    if (dto.initialBalanceDate && dto.initialBalanceDate > today) {
      throw ValidationError.forField(
        'initialBalanceDate',
        'No puede ser una fecha futura',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      const account = await this.accountsRepository.findOwned(
        user.id,
        accountId,
        manager,
      );
      if (!account) {
        throw new NotFoundError();
      }
      if (account.type === ACCOUNT_TYPE_DB[AccountType.CREDIT]) {
        throw new NotEditableError(
          'La cuenta de una tarjeta de crédito se edita desde la tarjeta.',
        );
      }
      if (
        dto.initialBalanceDate &&
        dto.initialBalanceDate > account.initialBalanceDate &&
        (await this.accountsRepository.hasTransfersOrPocketMovementsBefore(
          manager,
          accountId,
          dto.initialBalanceDate,
        ))
      ) {
        throw new ConflictError(
          'Hay traspasos o movimientos de apartado anteriores a esa fecha en esta cuenta.',
          {
            initialBalanceDate: 'Hay traspasos o abonos anteriores a esa fecha',
          },
        );
      }
      const willBeActive = dto.isActive ?? account.isActive;
      const name = dto.name ?? account.name;
      if (
        willBeActive &&
        (dto.name !== undefined || dto.isActive === true) &&
        (await this.accountsRepository.isNameTaken(
          user.id,
          name,
          accountId,
          manager,
        ))
      ) {
        throw NAME_CONFLICT();
      }
      await this.accountsRepository.update(manager, accountId, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.initialBalance !== undefined
          ? { initialBalance: centsToNumeric(toCents(dto.initialBalance)) }
          : {}),
        ...(dto.initialBalanceDate !== undefined
          ? { initialBalanceDate: dto.initialBalanceDate }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      if (account.isActive && dto.isActive === false) {
        await this.accountsRepository.deactivateDependents(manager, accountId);
      }
    });
    return this.findOne(user, accountId);
  }

  /**
   * Una cuenta para un movimiento nuevo: del usuario, activa y de un tipo
   * permitido (requerimientos-backend.md §4). Los errores van al campo del
   * formulario que la eligió.
   */
  async requireUsable(
    manager: EntityManager,
    userId: string,
    accountId: string,
    options: { types: DbAccountType[]; field: string; allowInactive?: boolean },
  ): Promise<Account> {
    const account = await this.accountsRepository.findOwned(
      userId,
      accountId,
      manager,
    );
    if (!account) {
      throw ValidationError.forField(options.field, 'La cuenta no existe');
    }
    if (!account.isActive && !options.allowInactive) {
      throw ValidationError.forField(
        options.field,
        'La cuenta está desactivada',
      );
    }
    if (!options.types.includes(account.type)) {
      throw ValidationError.forField(
        options.field,
        accountTypeMessage(options.types),
      );
    }
    return account;
  }

  /** Efectivo o débito: de donde sale un abono, un pago de tarjeta o adonde entra un ingreso. */
  requireLiquid(
    manager: EntityManager,
    userId: string,
    accountId: string,
    field: string,
  ): Promise<Account> {
    return this.requireUsable(manager, userId, accountId, {
      types: LIQUID_ACCOUNT_TYPES,
      field,
    });
  }

  private async toDtos(
    user: AuthUser,
    accounts: Account[],
  ): Promise<AccountDto[]> {
    const [balances, cards] = await Promise.all([
      this.balancesService.accountBalancesOn(user.id, todayIn(user.timeZone), {
        accountIds: accounts.map((account) => account.id),
      }),
      this.accountsRepository.findActiveCards(
        accounts.map((account) => account.id),
      ),
    ]);
    return accounts.map((account) =>
      toAccountDto(
        account,
        balances.get(account.id)?.balanceCents ??
          toCents(account.initialBalance),
        cards.filter((card) => card.accountId === account.id),
      ),
    );
  }
}

function accountTypeMessage(types: DbAccountType[]): string {
  if (types.length === 1 && types[0] === ACCOUNT_TYPE_DB[AccountType.CASH]) {
    return 'Debe ser una cuenta de efectivo';
  }
  if (types.length === 1 && types[0] === ACCOUNT_TYPE_DB[AccountType.DEBIT]) {
    return 'Debe ser una cuenta de débito';
  }
  return 'Debe ser una cuenta de efectivo o de débito';
}
