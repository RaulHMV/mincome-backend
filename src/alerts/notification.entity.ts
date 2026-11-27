import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Las alertas se calculan al vuelo; aquí solo queda cuáles leyó el usuario (requerimientos-backend.md §2.9). */
@Entity({ name: 'notificaciones', synchronize: false })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'tipo', type: 'varchar', length: 30 })
  type: string;

  @Column({ name: 'datos', type: 'jsonb' })
  data: object;

  /** El id de la alerta, como 'budget:<id>:2026-10'. */
  @Column({ name: 'clave', type: 'varchar', length: 120 })
  key: string;

  @Column({ name: 'leida_en', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;
}
