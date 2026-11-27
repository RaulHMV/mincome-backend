import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { NotFoundError } from '../common/errors/api-error';
import {
  toConversationDto,
  toMessageDto,
  type ConversationDetailDto,
  type ConversationDto,
} from './conversation.mapper';
import { ConversationsRepository } from './conversations.repository';

/** El historial de Piggy (contrato §3.7). Los mensajes nuevos llegan por las rutas internas. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
  ) {}

  async list(user: AuthUser): Promise<ConversationDto[]> {
    const rows = await this.conversationsRepository.findForUser(user.id);
    return rows.map((row) => toConversationDto(row, user.timeZone));
  }

  async findOne(
    user: AuthUser,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    const conversation = await this.conversationsRepository.findOwned(
      user.id,
      conversationId,
    );
    if (!conversation) {
      throw new NotFoundError();
    }
    const messages =
      await this.conversationsRepository.findMessages(conversationId);
    return {
      ...toConversationDto(conversation, user.timeZone),
      messages: messages.map((message) => toMessageDto(message, user.timeZone)),
    };
  }

  async remove(user: AuthUser, conversationId: string): Promise<void> {
    if (!(await this.conversationsRepository.delete(user.id, conversationId))) {
      throw new NotFoundError();
    }
  }
}
