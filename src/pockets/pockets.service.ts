import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import type { AuthUser } from '../auth/auth-user';
import { BalancesService } from '../balances/balances.service';
import { formatTimestamp, todayIn } from '../common/dates';
import { POCKET_MOVEMENT_TYPE_DB, PocketMovementType } from '../common/enums';
import {
  ConflictError,
  InsufficientFundsError,
  NotFoundError,
  ValidationError,
} from '../common/errors/api-error';
import { centsToNumeric, fromCents, toCents } from '../common/money';
import type { Page, PageRequest } from '../common/pagination';
import { toAccountSummary } from '../common/summaries';
import type {
  CreatePocketDto,
  CreatePocketMovementDto,
  ListPocketsQuery,
  ReleasePocketDto,
  UpdatePocketDto,
} from './dto/pocket.dto';
import { MAX_ACTIVE_POCKETS } from './pocket.calculator';
import {
  toPocketDto,
  toPocketMovementDto,
  type PocketDto,
  type PocketMovementDto,
} from './pocket.mapper';
import { PocketsRepository, type PocketRow } from './pockets.repository';

export interface PocketMovementResult {
  movement: PocketMovementDto;
  /** El apartado con su saldo y progreso nuevos. */
  pocket: PocketDto;
}

interface MovementRequest {
  type: PocketMovementType;
  amountCents: number;
  date: string;
  accountId: string;
  note: string | null;
}

const NAME_CONFLICT = () =>
  new ConflictError('Ya tienes un apartado activo con ese nombre.', {
    name: 'Ya existe un apartado activo con ese nombre',
  });

@Injectable()
export class PocketsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pocketsRepository: PocketsRepository,
    private readonly accountsService: AccountsService,
    private readonly balancesService: BalancesService,
  ) {}

  async list(user: AuthUser, query: ListPocketsQuery): Promise<PocketDto[]> {
    const pockets = await this.pocketsRepository.findForUser(
      user.id,
      query.isActive ?? null,
    );
    return pockets.map((pocket) => toPocketDto(pocket, user.timeZone));
  }

  /** "Nueva meta de ahorro": máximo 10 activos y nombre único entre ellos (§3.4). */
  async create(user: AuthUser, dto: CreatePocketDto): Promise<PocketDto> {
    const today = todayIn(user.timeZone);
    const pocketId = await this.dataSource.transaction(async (manager) => {
      const active = await this.pocketsRepository.countActiveLockingOwner(
        manager,
        user.id,
      );
      if (active >= MAX_ACTIVE_POCKETS) {
        throw new ConflictError(
          `Ya tienes ${MAX_ACTIVE_POCKETS} apartados activos; libera uno para crear otro.`,
        );
      }
      if (
        await this.pocketsRepository.isNameTaken(
          manager,
          user.id,
          dto.name,
          null,
        )
      ) {
        throw NAME_CONFLICT();
      }
      const id = await this.pocketsRepository.insert(manager, {
        userId: user.id,
        name: dto.name,
        balance: '0.00',
        targetAmount: centsToNumeric(toCents(dto.targetAmount)),
        targetDate: dto.targetDate,
        icon: dto.icon,
        colorHex: dto.colorHex,
      });
      if (dto.initialAmount > 0 && dto.sourceAccountId) {
        const pocket = await this.requireOwned(manager, user.id, id);
        await this.applyMovement(
          manager,
          user,
          pocket,
          {
            type: PocketMovementType.DEPOSIT,
            amountCents: toCents(dto.initialAmount),
            date: today,
            accountId: dto.sourceAccountId,
            note: null,
          },
          {
            dryRun: false,
            accountField: 'sourceAccountId',
            amountField: 'initialAmount',
          },
        );
      }
      return id;
    });
    return this.findOne(user, pocketId);
  }

  async update(
    user: AuthUser,
    pocketId: string,
    dto: UpdatePocketDto,
  ): Promise<PocketDto> {
    await this.dataSource.transaction(async (manager) => {
      const pocket = await this.requireOwned(manager, user.id, pocketId);
      if (!pocket.isActive) {
        throw new ConflictError('El apartado ya está cerrado.');
      }
      if (
        dto.name &&
        (await this.pocketsRepository.isNameTaken(
          manager,
          user.id,
          dto.name,
          pocketId,
        ))
      ) {
        throw NAME_CONFLICT();
      }
      await this.pocketsRepository.update(manager, pocketId, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.targetAmount !== undefined
          ? { targetAmount: centsToNumeric(toCents(dto.targetAmount)) }
          : {}),
        ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.colorHex !== undefined ? { colorHex: dto.colorHex } : {}),
      });
    });
    return this.findOne(user, pocketId);
  }

  /**
   * "Liberar y completar meta": retira todo el saldo a la cuenta destino,
   * como un movimiento de retiro, y cierra el apartado (decisión D7).
   */
  async release(
    user: AuthUser,
    pocketId: string,
    dto: ReleasePocketDto,
  ): Promise<PocketDto> {
    const today = todayIn(user.timeZone);
    await this.dataSource.transaction(async (manager) => {
      const pocket = await this.requireOwned(manager, user.id, pocketId, {
        lock: true,
      });
      if (!pocket.isActive) {
        throw new ConflictError('El apartado ya está cerrado.');
      }
      await this.accountsService.requireLiquid(
        manager,
        user.id,
        dto.destinationAccountId,
        'destinationAccountId',
      );
      const balanceCents = toCents(pocket.balance);
      if (balanceCents > 0) {
        await this.applyMovement(
          manager,
          user,
          pocket,
          {
            type: PocketMovementType.WITHDRAWAL,
            amountCents: balanceCents,
            date: today,
            accountId: dto.destinationAccountId,
            note: null,
          },
          {
            dryRun: false,
            accountField: 'destinationAccountId',
            amountField: 'amount',
          },
        );
      }
      await this.pocketsRepository.update(manager, pocketId, {
        isActive: false,
      });
    });
    return this.findOne(user, pocketId);
  }

  async listMovements(
    user: AuthUser,
    pocketId: string,
    page: PageRequest,
  ): Promise<Page<PocketMovementDto>> {
    await this.requireOwned(this.dataSource.manager, user.id, pocketId);
    const { rows, total } = await this.pocketsRepository.findMovementsPage(
      pocketId,
      page,
    );
    return {
      items: rows.map((row) => toPocketMovementDto(row, user.timeZone)),
      page: page.page,
      pageSize: page.pageSize,
      total,
    };
  }

  /** "+ Abonar" o "− Retirar"; con dryRun valida y calcula sin guardar (contrato §1). */
  async addMovement(
    user: AuthUser,
    pocketId: string,
    dto: CreatePocketMovementDto,
    { dryRun }: { dryRun: boolean },
  ): Promise<PocketMovementResult> {
    const today = todayIn(user.timeZone);
    return this.dataSource.transaction(async (manager) => {
      const pocket = await this.requireOwned(manager, user.id, pocketId, {
        lock: true,
      });
      const request: MovementRequest = {
        type: dto.type,
        amountCents: toCents(dto.amount),
        date: dto.date ?? today,
        accountId: dto.accountId,
        note: dto.note,
      };
      const movementId = await this.applyMovement(
        manager,
        user,
        pocket,
        request,
        {
          dryRun,
          accountField: 'accountId',
          amountField: 'amount',
        },
      );
      if (dryRun || movementId === null) {
        return this.preview(manager, user, pocket, request);
      }
      const movement = await this.pocketsRepository.findMovementView(
        manager,
        movementId,
      );
      const updated = await this.requireOwned(manager, user.id, pocketId);
      if (!movement) {
        throw new NotFoundError();
      }
      return {
        movement: toPocketMovementDto(movement, user.timeZone),
        pocket: toPocketDto(updated, user.timeZone),
      };
    });
  }

  /**
   * Las reglas de abonos y retiros (requerimientos-backend.md §3.4): solo en
   * apartados activos y con cuentas de efectivo o débito; un abono no pasa del
   * saldo de la cuenta (D6, D15) y un retiro no pasa del saldo del apartado.
   * El saldo del apartado se actualiza en la misma transacción que el
   * movimiento. Regresa el id del movimiento, o null con dryRun.
   */
  private async applyMovement(
    manager: EntityManager,
    user: AuthUser,
    pocket: PocketRow,
    request: MovementRequest,
    options: { dryRun: boolean; accountField: string; amountField: string },
  ): Promise<string | null> {
    const today = todayIn(user.timeZone);
    if (!pocket.isActive) {
      throw new ConflictError('El apartado está cerrado.');
    }
    if (request.date > today) {
      throw ValidationError.forField('date', 'No puede ser una fecha futura');
    }
    const account = await this.accountsService.requireLiquid(
      manager,
      user.id,
      request.accountId,
      options.accountField,
    );
    // Antes del saldo inicial la cuenta no existía: el patrimonio dejaría de cuadrar.
    if (request.date < account.initialBalanceDate) {
      throw ValidationError.forField(
        'date',
        'Es anterior al saldo inicial de la cuenta',
      );
    }
    await this.balancesService.lockAccounts(manager, [account.id]);
    const amount = centsToNumeric(request.amountCents);

    if (request.type === PocketMovementType.DEPOSIT) {
      await this.balancesService.assertCanSpend(manager, user.id, {
        account,
        amountCents: request.amountCents,
        date: request.date,
        today,
        field: options.amountField,
      });
      if (!options.dryRun) {
        await this.pocketsRepository.addToBalance(manager, pocket.id, amount);
      }
    } else {
      const fits = options.dryRun
        ? request.amountCents <= toCents(pocket.balance)
        : await this.pocketsRepository.subtractFromBalance(
            manager,
            pocket.id,
            amount,
          );
      if (!fits) {
        throw new InsufficientFundsError(
          'El retiro es mayor al saldo del apartado.',
          {
            [options.amountField]: 'Es mayor al saldo del apartado',
          },
        );
      }
    }

    if (options.dryRun) {
      return null;
    }
    return this.pocketsRepository.insertMovement(manager, {
      pocketId: pocket.id,
      userId: user.id,
      accountId: account.id,
      type: POCKET_MOVEMENT_TYPE_DB[request.type],
      amount,
      date: request.date,
      note: request.note,
    });
  }

  private async preview(
    manager: EntityManager,
    user: AuthUser,
    pocket: PocketRow,
    request: MovementRequest,
  ): Promise<PocketMovementResult> {
    const account = await this.accountsService.requireLiquid(
      manager,
      user.id,
      request.accountId,
      'accountId',
    );
    const sign = request.type === PocketMovementType.DEPOSIT ? 1 : -1;
    const balanceCents = toCents(pocket.balance) + sign * request.amountCents;
    return {
      movement: {
        id: null,
        pocketId: pocket.id,
        type: request.type,
        amount: fromCents(request.amountCents),
        date: request.date,
        note: request.note,
        account: toAccountSummary(account),
        createdAt: formatTimestamp(new Date(), user.timeZone),
      },
      pocket: toPocketDto(
        { ...pocket, balance: centsToNumeric(balanceCents) },
        user.timeZone,
      ),
    };
  }

  private async findOne(user: AuthUser, pocketId: string): Promise<PocketDto> {
    return toPocketDto(
      await this.requireOwned(this.dataSource.manager, user.id, pocketId),
      user.timeZone,
    );
  }

  private async requireOwned(
    manager: EntityManager,
    userId: string,
    pocketId: string,
    options: { lock?: boolean } = {},
  ): Promise<PocketRow> {
    const pocket = await this.pocketsRepository.findOwned(
      userId,
      pocketId,
      manager,
      options,
    );
    if (!pocket) {
      throw new NotFoundError();
    }
    return pocket;
  }
}
