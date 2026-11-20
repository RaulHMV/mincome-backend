import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { ParseUuidPipe } from '../common/validation/id.pipes';
import {
  createRecurringTransactionSchema,
  listRecurringTransactionsQuerySchema,
  updateRecurringTransactionSchema,
  type CreateRecurringTransactionDto,
  type ListRecurringTransactionsQuery,
  type UpdateRecurringTransactionDto,
} from './dto/recurring-transaction.dto';
import type { RecurringTransactionDto } from './recurring-transaction.mapper';
import {
  RecurringTransactionsService,
  type CreateRecurringTransactionResult,
} from './recurring-transactions.service';

@Controller('recurring-transactions')
export class RecurringTransactionsController {
  constructor(
    private readonly recurringTransactionsService: RecurringTransactionsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listRecurringTransactionsQuerySchema })
    query: ListRecurringTransactionsQuery,
  ): Promise<RecurringTransactionDto[]> {
    return this.recurringTransactionsService.list(user, query);
  }

  /** Excepción del contrato: regresa también las ocurrencias que ya tocaban. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createRecurringTransactionSchema })
    dto: CreateRecurringTransactionDto,
  ): Promise<CreateRecurringTransactionResult> {
    return this.recurringTransactionsService.create(user, dto);
  }

  @Patch(':recurringTransactionId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('recurringTransactionId', ParseUuidPipe)
    recurringTransactionId: string,
    @Body({ schema: updateRecurringTransactionSchema })
    dto: UpdateRecurringTransactionDto,
  ): Promise<RecurringTransactionDto> {
    return this.recurringTransactionsService.update(
      user,
      recurringTransactionId,
      dto,
    );
  }
}
