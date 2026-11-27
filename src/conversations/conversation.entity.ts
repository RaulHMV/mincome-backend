import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'conversaciones_chat', synchronize: false })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'titulo', type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
