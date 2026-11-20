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
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { ParseUuidPipe } from '../common/validation/id.pipes';
import { MovesMoney } from '../idempotency/moves-money.decorator';
import type { CardDto, TransferDto } from './card.mapper';
import { CardsService } from './cards.service';
import {
  createCardSchema,
  listCardsQuerySchema,
  payCardSchema,
  updateCardSchema,
  type CreateCardDto,
  type ListCardsQuery,
  type PayCardDto,
  type UpdateCardDto,
} from './dto/card.dto';

@Controller('cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listCardsQuerySchema }) query: ListCardsQuery,
  ): Promise<CardDto[]> {
    return this.cardsService.list(user, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createCardSchema }) dto: CreateCardDto,
  ): Promise<CardDto> {
    return this.cardsService.create(user, dto);
  }

  @Patch(':cardId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('cardId', ParseUuidPipe) cardId: string,
    @Body({ schema: updateCardSchema }) dto: UpdateCardDto,
  ): Promise<CardDto> {
    return this.cardsService.update(user, cardId, dto);
  }

  @Delete(':cardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('cardId', ParseUuidPipe) cardId: string,
  ): Promise<void> {
    return this.cardsService.remove(user, cardId);
  }

  @Post(':cardId/payments')
  @MovesMoney()
  pay(
    @CurrentUser() user: AuthUser,
    @Param('cardId', ParseUuidPipe) cardId: string,
    @Body({ schema: payCardSchema }) dto: PayCardDto,
  ): Promise<TransferDto> {
    return this.cardsService.pay(user, cardId, dto);
  }
}
