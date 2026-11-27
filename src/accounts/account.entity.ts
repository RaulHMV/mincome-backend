import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DbAccountType } from '../common/enums';

@Entity({ name: 'cuentas', synchronize: false })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'nombre', type: 'varchar', length: 50 })
  name: string;

  @Column({
    name: 'tipo',
    type: 'enum',
    enum: ['efectivo', 'debito', 'credito'],
    enumName: 'tipo_cuenta',
  })
  type: DbAccountType;

  /** En crédito, negativo = deuda inicial. */
  @Column({ name: 'saldo_inicial', type: 'numeric', precision: 14, scale: 2 })
  initialBalance: string;

  @Column({ name: 'fecha_saldo_inicial', type: 'date' })
  initialBalanceDate: string;

  @Column({ name: 'activa', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
