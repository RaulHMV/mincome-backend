import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'apartados', synchronize: false })
export class Pocket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'nombre', type: 'varchar', length: 60 })
  name: string;

  /** Total guardado: se actualiza en la misma transacción que inserta cada movimiento. */
  @Column({ name: 'saldo', type: 'numeric', precision: 14, scale: 2 })
  balance: string;

  @Column({
    name: 'meta_monto',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  targetAmount: string | null;

  @Column({ name: 'fecha_meta', type: 'date', nullable: true })
  targetDate: string | null;

  @Column({ name: 'color_hex', type: 'char', length: 7, nullable: true })
  colorHex: string | null;

  @Column({ name: 'icono', type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ name: 'activo', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
