import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { PremiumGuard } from '../auth/premium.guard';
import { ParseUuidPipe } from '../common/validation/id.pipes';
import type {
  ConversationDetailDto,
  ConversationDto,
} from './conversation.mapper';
import { ConversationsService } from './conversations.service';

/** Solo `premium`: a los demás, 403 premium_required (contrato §3.7). */
@Controller('conversations')
@UseGuards(PremiumGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /** La más reciente primero. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationDto[]> {
    return this.conversationsService.list(user);
  }

  @Get(':conversationId')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUuidPipe) conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.findOne(user, conversationId);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUuidPipe) conversationId: string,
  ): Promise<void> {
    return this.conversationsService.remove(user, conversationId);
  }
}
