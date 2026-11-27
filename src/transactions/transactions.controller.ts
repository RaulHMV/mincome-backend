import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { ParseUuidPipe } from '../common/validation/id.pipes';
import { dryRunQuerySchema } from '../common/validation/schemas';
import { MovesMoney } from '../idempotency/moves-money.decorator';
import {
  createTransactionSchema,
  updateTransactionSchema,
  type CreateTransactionDto,
  type UpdateTransactionDto,
} from './dto/transaction.dto';
import type { TransactionDto } from './transaction.mapper';
import {
  TransactionsService,
  type TransactionWriteResult,
} from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get(':transactionId')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', ParseUuidPipe) transactionId: string,
  ): Promise<TransactionDto> {
    return this.transactionsService.findOne(user, transactionId);
  }

  /** 201, o 200 con ?dryRun=true, que no guarda nada. */
  @Post()
  @MovesMoney()
  create(
    @CurrentUser() user: AuthUser,
    @Query({ schema: dryRunQuerySchema }) query: { dryRun: boolean },
    @Body({ schema: createTransactionSchema }) dto: CreateTransactionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransactionWriteResult> {
    if (query.dryRun) {
      response.status(HttpStatus.OK);
    }
    return this.transactionsService.create(user, dto, { dryRun: query.dryRun });
  }

  @Patch(':transactionId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', ParseUuidPipe) transactionId: string,
    @Body({ schema: updateTransactionSchema }) dto: UpdateTransactionDto,
  ): Promise<TransactionWriteResult> {
    return this.transactionsService.update(user, transactionId, dto);
  }

  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', ParseUuidPipe) transactionId: string,
  ): Promise<void> {
    return this.transactionsService.remove(user, transactionId);
  }
}
