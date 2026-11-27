import {
  Body,
  Controller,
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
import type { Page, PageRequest } from '../common/pagination';
import { ParseUuidPipe } from '../common/validation/id.pipes';
import {
  dryRunQuerySchema,
  paginationQuerySchema,
} from '../common/validation/schemas';
import { MovesMoney } from '../idempotency/moves-money.decorator';
import {
  createPocketMovementSchema,
  createPocketSchema,
  listPocketsQuerySchema,
  releasePocketSchema,
  updatePocketSchema,
  type CreatePocketDto,
  type CreatePocketMovementDto,
  type ListPocketsQuery,
  type ReleasePocketDto,
  type UpdatePocketDto,
} from './dto/pocket.dto';
import type { PocketDto, PocketMovementDto } from './pocket.mapper';
import { PocketsService, type PocketMovementResult } from './pockets.service';

@Controller('pockets')
export class PocketsController {
  constructor(private readonly pocketsService: PocketsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listPocketsQuerySchema }) query: ListPocketsQuery,
  ): Promise<PocketDto[]> {
    return this.pocketsService.list(user, query);
  }

  /** Un reintento no duplica: el nombre es único entre los activos (409 conflict). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createPocketSchema }) dto: CreatePocketDto,
  ): Promise<PocketDto> {
    return this.pocketsService.create(user, dto);
  }

  @Patch(':pocketId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('pocketId', ParseUuidPipe) pocketId: string,
    @Body({ schema: updatePocketSchema }) dto: UpdatePocketDto,
  ): Promise<PocketDto> {
    return this.pocketsService.update(user, pocketId, dto);
  }

  /** Un reintento no retira dos veces: el apartado ya cerrado responde 409. */
  @Post(':pocketId/release')
  @HttpCode(HttpStatus.OK)
  release(
    @CurrentUser() user: AuthUser,
    @Param('pocketId', ParseUuidPipe) pocketId: string,
    @Body({ schema: releasePocketSchema }) dto: ReleasePocketDto,
  ): Promise<PocketDto> {
    return this.pocketsService.release(user, pocketId, dto);
  }

  @Get(':pocketId/movements')
  listMovements(
    @CurrentUser() user: AuthUser,
    @Param('pocketId', ParseUuidPipe) pocketId: string,
    @Query({ schema: paginationQuerySchema }) page: PageRequest,
  ): Promise<Page<PocketMovementDto>> {
    return this.pocketsService.listMovements(user, pocketId, page);
  }

  /** 201, o 200 con ?dryRun=true, que no guarda nada. */
  @Post(':pocketId/movements')
  @MovesMoney()
  addMovement(
    @CurrentUser() user: AuthUser,
    @Param('pocketId', ParseUuidPipe) pocketId: string,
    @Query({ schema: dryRunQuerySchema }) query: { dryRun: boolean },
    @Body({ schema: createPocketMovementSchema }) dto: CreatePocketMovementDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PocketMovementResult> {
    if (query.dryRun) {
      response.status(HttpStatus.OK);
    }
    return this.pocketsService.addMovement(user, pocketId, dto, {
      dryRun: query.dryRun,
    });
  }
}
