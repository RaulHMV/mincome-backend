import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MESSAGE_ROLE_DB, MessageRole, PlanName } from '../common/enums';
import {
  ConflictError,
  NotFoundError,
  PremiumRequiredError,
  QuotaExceededError,
} from '../common/errors/api-error';
import {
  AiQuotasRepository,
  type AiUsageRow,
} from '../plans/ai-quotas.repository';
import { PlansRepository } from '../plans/plans.repository';
import { UsersRepository } from '../users/users.repository';
import { currentQuotaPeriod } from '../users/users.service';
import {
  titleFrom,
  toMessageDto,
  type MessageDto,
} from './conversation.mapper';
import { ConversationsRepository } from './conversations.repository';
import type { FinishChatTurnDto, StartChatTurnDto } from './dto/chat-turn.dto';

/** requerimientos-ia.md: el modelo ve los últimos 10 mensajes. */
const HISTORY_SIZE = 10;

export interface StartedChatTurn {
  /** El id del mensaje del usuario ya guardado. */
  turnId: string;
  conversationId: string;
  /** Los últimos 10, sin contar el nuevo. */
  history: MessageDto[];
  aiUsage: AiUsageRow;
}

export interface FinishedChatTurn {
  /** null si el turno falló. */
  message: MessageDto | null;
  aiUsage: AiUsageRow;
}

/**
 * Las rutas internas de mincome-ai-wrapper (contrato §3.8). La cuota se
 * reserva al empezar el turno, en el mismo paso, para que dos mensajes
 * simultáneos no pasen el tope (requerimientos-ia.md §7).
 */
@Injectable()
export class ChatTurnsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly plansRepository: PlansRepository,
    private readonly aiQuotasRepository: AiQuotasRepository,
  ) {}

  async start(dto: StartChatTurnDto): Promise<StartedChatTurn> {
    const user = await this.usersRepository.findIdentityBySub(dto.userSub);
    if (!user || !user.isActive) {
      throw new NotFoundError('No encontramos al usuario.');
    }
    // usuarios.plan_id es la fuente de verdad, no el grupo del token.
    if (user.plan !== PlanName.PREMIUM) {
      throw new PremiumRequiredError();
    }
    const plan = await this.plansRepository.findByName(user.plan);
    const period = currentQuotaPeriod(user.timeZone);

    return this.dataSource.transaction(async (manager) => {
      const existing = dto.conversationId
        ? await this.conversationsRepository.findOwned(
            user.id,
            dto.conversationId,
            manager,
            { lock: true },
          )
        : null;
      if (dto.conversationId && !existing) {
        throw new NotFoundError('No encontramos la conversación.');
      }
      const aiUsage = await this.aiQuotasRepository.reserveQuery(
        manager,
        user.id,
        period,
        { queries: plan.monthlyQueryLimit, tokens: plan.monthlyTokenLimit },
      );
      if (!aiUsage) {
        throw new QuotaExceededError();
      }
      const conversation =
        existing ??
        (await this.conversationsRepository.insertConversation(
          manager,
          user.id,
          titleFrom(dto.content),
        ));
      const message = await this.conversationsRepository.insertMessage(
        manager,
        {
          conversationId: conversation.id,
          role: MESSAGE_ROLE_DB[MessageRole.USER],
          content: dto.content,
        },
      );
      await this.conversationsRepository.touch(manager, conversation.id, null);
      const history = await this.conversationsRepository.findHistory(
        manager,
        conversation.id,
        message.id,
        HISTORY_SIZE,
      );
      return {
        turnId: message.id,
        conversationId: conversation.id,
        history: history.map((row) => toMessageDto(row, user.timeZone)),
        aiUsage,
      };
    });
  }

  async finish(
    turnId: string,
    dto: FinishChatTurnDto,
  ): Promise<FinishedChatTurn> {
    return this.dataSource.transaction(async (manager) => {
      const turn = await this.conversationsRepository.findTurnForUpdate(
        manager,
        turnId,
      );
      if (!turn || turn.role !== MESSAGE_ROLE_DB[MessageRole.USER]) {
        throw new NotFoundError('No encontramos el turno.');
      }
      // Con la conversación bloqueada, cerrar dos veces el mismo turno no pasa.
      if (
        await this.conversationsRepository.hasMessagesAfter(
          manager,
          turn.conversationId,
          turn.id,
        )
      ) {
        throw new ConflictError('Este turno ya terminó.');
      }
      // El mes en que empezó el turno, aunque termine pasada la medianoche.
      const period = currentQuotaPeriod(turn.timeZone, turn.createdAt);

      if (dto.status === 'failed') {
        // Se devuelve la consulta y el mensaje del usuario sale del historial.
        await this.conversationsRepository.deleteMessage(manager, turn.id);
        await this.conversationsRepository.deleteIfEmpty(
          manager,
          turn.conversationId,
        );
        await this.aiQuotasRepository.refundQuery(manager, turn.userId, period);
        return {
          message: null,
          aiUsage: await this.aiQuotasRepository.findUsage(
            turn.userId,
            period,
            manager,
          ),
        };
      }

      const message = await this.conversationsRepository.insertMessage(
        manager,
        {
          conversationId: turn.conversationId,
          role: MESSAGE_ROLE_DB[MessageRole.ASSISTANT],
          content: dto.assistantMessage,
          toolsUsed: dto.toolsUsed,
          inputTokens: dto.inputTokens,
          outputTokens: dto.outputTokens,
        },
      );
      await this.conversationsRepository.touch(
        manager,
        turn.conversationId,
        dto.title,
      );
      return {
        message: toMessageDto(message, turn.timeZone),
        aiUsage: await this.aiQuotasRepository.addTokens(
          manager,
          turn.userId,
          period,
          dto.inputTokens + dto.outputTokens,
        ),
      };
    });
  }
}
