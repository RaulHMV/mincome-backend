import { formatTimestamp } from '../common/dates';
import { fromDb, MESSAGE_ROLE_DB, type MessageRole } from '../common/enums';

export interface ConversationRow {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

/** Contrato §2, `Conversation`. */
export interface ConversationDto {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Contrato §2, `Message`. El id es BIGINT y viaja como texto. */
export interface MessageDto {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

/** Contrato §2, `ConversationDetail`: los mensajes en orden cronológico. */
export interface ConversationDetailDto extends ConversationDto {
  messages: MessageDto[];
}

export function toConversationDto(
  row: ConversationRow,
  timeZone: string,
): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: formatTimestamp(row.createdAt, timeZone),
    updatedAt: formatTimestamp(row.updatedAt, timeZone),
  };
}

export function toMessageDto(row: MessageRow, timeZone: string): MessageDto {
  return {
    id: row.id,
    role: fromDb(MESSAGE_ROLE_DB, row.role),
    content: row.content,
    createdAt: formatTimestamp(row.createdAt, timeZone),
  };
}

/** requerimientos-ia.md: los primeros 60 caracteres del primer mensaje. */
export function titleFrom(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 60);
}
