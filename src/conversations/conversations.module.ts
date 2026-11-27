import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlansModule } from '../plans/plans.module';
import { UsersModule } from '../users/users.module';
import { ChatTurnsService } from './chat-turns.service';
import { Conversation } from './conversation.entity';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { InternalChatTurnsController } from './internal-chat-turns.controller';
import { Message } from './message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    AuthModule,
    UsersModule,
    PlansModule,
  ],
  controllers: [ConversationsController, InternalChatTurnsController],
  providers: [ConversationsRepository, ConversationsService, ChatTurnsService],
})
export class ConversationsModule {}
