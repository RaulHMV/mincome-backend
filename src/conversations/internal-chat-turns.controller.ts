import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { InternalApiGuard } from '../auth/internal-api.guard';
import { ParseBigIntIdPipe } from '../common/validation/id.pipes';
import {
  ChatTurnsService,
  type FinishedChatTurn,
  type StartedChatTurn,
} from './chat-turns.service';
import {
  finishChatTurnSchema,
  startChatTurnSchema,
  type FinishChatTurnDto,
  type StartChatTurnDto,
} from './dto/chat-turn.dto';

/**
 * Solo para mincome-ai-wrapper (contrato §3.8): sin JWT de usuario, con
 * autorización IAM en API Gateway (o la llave interna en local). Por eso el
 * usuario viene como `userSub` en el body.
 */
@Controller('internal/chat-turns')
@Public()
@UseGuards(InternalApiGuard)
export class InternalChatTurnsController {
  constructor(private readonly chatTurnsService: ChatTurnsService) {}

  @Post()
  start(
    @Body({ schema: startChatTurnSchema }) dto: StartChatTurnDto,
  ): Promise<StartedChatTurn> {
    return this.chatTurnsService.start(dto);
  }

  @Patch(':turnId')
  finish(
    @Param('turnId', ParseBigIntIdPipe) turnId: string,
    @Body({ schema: finishChatTurnSchema }) dto: FinishChatTurnDto,
  ): Promise<FinishedChatTurn> {
    return this.chatTurnsService.finish(turnId, dto);
  }
}
