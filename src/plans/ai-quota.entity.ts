import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cuotas_ia', synchronize: false })
export class AiQuota {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  /** Primer día del mes, en la zona horaria del usuario. */
  @Column({ name: 'periodo', type: 'date' })
  period: string;

  @Column({ name: 'consultas_usadas', type: 'int' })
  queriesUsed: number;

  @Column({ name: 'tokens_usados', type: 'int' })
  tokensUsed: number;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
