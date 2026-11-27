import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DbMessageRole } from '../common/enums';

@Entity({ name: 'mensajes_chat', synchronize: false })
export class Message {
  /** BIGINT: `pg` lo entrega como texto y la API lo expone igual (contrato §1, "IDs"). */
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ name: 'conversacion_id', type: 'uuid' })
  conversationId: string;

  @Column({
    name: 'rol',
    type: 'enum',
    enum: ['usuario', 'asistente', 'sistema'],
    enumName: 'rol_mensaje',
  })
  role: DbMessageRole | 'sistema';

  @Column({ name: 'contenido', type: 'text' })
  content: string;

  @Column({
    name: 'estrategia_usada',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  strategyUsed: string | null;

  @Column({ name: 'herramientas_usadas', type: 'text', array: true })
  toolsUsed: string[];

  @Column({ name: 'tokens_entrada', type: 'int' })
  inputTokens: number;

  @Column({ name: 'tokens_salida', type: 'int' })
  outputTokens: number;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;
}
