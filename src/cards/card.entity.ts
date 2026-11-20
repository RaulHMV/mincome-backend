import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DbCardType } from '../common/enums';

/** RNF3: solo alias, banco y terminación; nunca número completo, CVV, NIP ni titular. */
@Entity({ name: 'tarjetas', synchronize: false })
export class Card {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'alias', type: 'varchar', length: 50 })
  alias: string;

  @Column({ name: 'banco', type: 'varchar', length: 50, nullable: true })
  bank: string | null;

  @Column({ name: 'terminacion', type: 'char', length: 4, nullable: true })
  last4: string | null;

  @Column({
    name: 'tipo_tarjeta',
    type: 'enum',
    enum: ['credito', 'debito'],
    enumName: 'tipo_tarjeta',
  })
  type: DbCardType;

  @Column({
    name: 'limite_credito',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  creditLimit: string | null;

  @Column({ name: 'dia_corte', type: 'smallint', nullable: true })
  cutoffDay: number | null;

  @Column({ name: 'dia_limite_pago', type: 'smallint', nullable: true })
  dueDay: number | null;

  @Column({ name: 'color_hex', type: 'char', length: 7, nullable: true })
  colorHex: string | null;

  @Column({ name: 'activa', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
