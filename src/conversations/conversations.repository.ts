import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { DbMessageRole } from '../common/enums';
import type { ConversationRow, MessageRow } from './conversation.mapper';

const CONVERSATION_COLUMNS = `id, usuario_id AS "userId", titulo AS title,
  creado_en AS "createdAt", actualizado_en AS "updatedAt"`;

// El id es BIGINT y sale como texto. Ojo: un ORDER BY id usa este alias y
// ordena como texto ('10' antes que '9'); hay que ordenar por m.id.
const MESSAGE_COLUMNS = `m.id::text AS id, m.conversacion_id AS "conversationId", m.rol AS role,
  m.contenido AS content, m.creado_en AS "createdAt"`;

/** Los mensajes de sistema no salen de la BD hacia la API ni al historial. */
const VISIBLE_ROLES = `m.rol IN ('usuario', 'asistente')`;

export interface TurnRow {
  id: string;
  conversationId: string;
  role: string;
  createdAt: Date;
  userId: string;
  timeZone: string;
}

export interface NewMessage {
  conversationId: string;
  role: DbMessageRole;
  content: string;
  toolsUsed?: string[];
  inputTokens?: number;
  outputTokens?: number;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly dataSource: DataSource) {}

  findForUser(userId: string): Promise<ConversationRow[]> {
    return this.dataSource.query(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversaciones_chat
       WHERE usuario_id = $1
       ORDER BY actualizado_en DESC, id`,
      [userId],
    );
  }

  async findOwned(
    userId: string,
    conversationId: string,
    manager: EntityManager = this.dataSource.manager,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<ConversationRow | null> {
    const rows: ConversationRow[] = await manager.query(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversaciones_chat
       WHERE id = $1 AND usuario_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
      [conversationId, userId],
    );
    return rows[0] ?? null;
  }

  findMessages(conversationId: string): Promise<MessageRow[]> {
    return this.dataSource.query(
      `SELECT ${MESSAGE_COLUMNS} FROM mensajes_chat m
       WHERE m.conversacion_id = $1 AND ${VISIBLE_ROLES}
       ORDER BY m.id`,
      [conversationId],
    );
  }

  /** Los últimos `limit` antes de `beforeId`, en orden cronológico. */
  findHistory(
    manager: EntityManager,
    conversationId: string,
    beforeId: string,
    limit: number,
  ): Promise<MessageRow[]> {
    return manager.query(
      `SELECT id, "conversationId", role, content, "createdAt" FROM (
         SELECT ${MESSAGE_COLUMNS}, m.id AS position FROM mensajes_chat m
         WHERE m.conversacion_id = $1 AND m.id < $2::bigint AND ${VISIBLE_ROLES}
         ORDER BY m.id DESC
         LIMIT $3
       ) historial
       ORDER BY position`,
      [conversationId, beforeId, limit],
    );
  }

  async insertConversation(
    manager: EntityManager,
    userId: string,
    title: string,
  ): Promise<ConversationRow> {
    const rows: ConversationRow[] = await manager.query(
      `INSERT INTO conversaciones_chat (usuario_id, titulo) VALUES ($1, $2)
       RETURNING ${CONVERSATION_COLUMNS}`,
      [userId, title],
    );
    return rows[0];
  }

  async insertMessage(
    manager: EntityManager,
    message: NewMessage,
  ): Promise<MessageRow> {
    const rows: MessageRow[] = await manager.query(
      `INSERT INTO mensajes_chat AS m
         (conversacion_id, rol, contenido, herramientas_usadas, tokens_entrada, tokens_salida)
       VALUES ($1, $2, $3, $4::text[], $5, $6)
       RETURNING ${MESSAGE_COLUMNS}`,
      [
        message.conversationId,
        message.role,
        message.content,
        message.toolsUsed ?? [],
        message.inputTokens ?? 0,
        message.outputTokens ?? 0,
      ],
    );
    return rows[0];
  }

  /** Mueve la conversación arriba de la lista y, si viene, le pone título. */
  async touch(
    manager: EntityManager,
    conversationId: string,
    title: string | null,
  ): Promise<void> {
    await manager.query(
      `UPDATE conversaciones_chat
       SET actualizado_en = now(), titulo = coalesce($2, titulo)
       WHERE id = $1`,
      [conversationId, title],
    );
  }

  /** El mensaje del usuario que abrió el turno, con su conversación bloqueada. */
  async findTurnForUpdate(
    manager: EntityManager,
    turnId: string,
  ): Promise<TurnRow | null> {
    const rows: TurnRow[] = await manager.query(
      `SELECT m.id::text AS id, m.conversacion_id AS "conversationId", m.rol AS role,
              m.creado_en AS "createdAt", c.usuario_id AS "userId", u.zona_horaria AS "timeZone"
       FROM mensajes_chat m
       JOIN conversaciones_chat c ON c.id = m.conversacion_id
       JOIN usuarios u ON u.id = c.usuario_id
       WHERE m.id = $1::bigint
       FOR UPDATE OF c`,
      [turnId],
    );
    return rows[0] ?? null;
  }

  async hasMessagesAfter(
    manager: EntityManager,
    conversationId: string,
    messageId: string,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM mensajes_chat WHERE conversacion_id = $1 AND id > $2::bigint LIMIT 1`,
      [conversationId, messageId],
    );
    return rows.length > 0;
  }

  async deleteMessage(
    manager: EntityManager,
    messageId: string,
  ): Promise<void> {
    await manager.query(`DELETE FROM mensajes_chat WHERE id = $1::bigint`, [
      messageId,
    ]);
  }

  /** Una conversación que se quedó sin mensajes (su único turno falló) se borra. */
  async deleteIfEmpty(
    manager: EntityManager,
    conversationId: string,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM conversaciones_chat c
       WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM mensajes_chat m WHERE m.conversacion_id = c.id)`,
      [conversationId],
    );
  }

  /** Sus mensajes se borran en cascada. */
  async delete(userId: string, conversationId: string): Promise<boolean> {
    // Con DELETE, query() de TypeORM regresa [filas, filas afectadas].
    const [, affected]: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM conversaciones_chat WHERE id = $1 AND usuario_id = $2`,
      [conversationId, userId],
    );
    return affected === 1;
  }
}
