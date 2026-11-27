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
import type { AccountDto } from './account.mapper';
import { AccountsService } from './accounts.service';
import {
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
  type CreateAccountDto,
  type ListAccountsQuery,
  type UpdateAccountDto,
} from './dto/account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listAccountsQuerySchema }) query: ListAccountsQuery,
  ): Promise<AccountDto[]> {
    return this.accountsService.list(user, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createAccountSchema }) dto: CreateAccountDto,
  ): Promise<AccountDto> {
    return this.accountsService.create(user, dto);
  }

  @Patch(':accountId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('accountId', ParseUuidPipe) accountId: string,
    @Body({ schema: updateAccountSchema }) dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    return this.accountsService.update(user, accountId, dto);
  }
}
