import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type {
  DbAlertLevel,
  DbFlowSubtype,
  DbFlowType,
  DbPaymentMethod,
} from '../common/enums';

@Entity({ name: 'transacciones', synchronize: false })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'categoria_id', type: 'int' })
  categoryId: number;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'tarjeta_id', type: 'uuid', nullable: true })
  cardId: string | null;

  @Column({ name: 'recurrente_id', type: 'uuid', nullable: true })
  recurringTransactionId: string | null;

  @Column({
    name: 'tipo_flujo',
    type: 'enum',
    enum: ['ingreso', 'gasto'],
    enumName: 'tipo_flujo',
  })
  type: DbFlowType;

  @Column({
    name: 'subtipo',
    type: 'enum',
    enum: ['recurrente', 'variable', 'fijo'],
    enumName: 'subtipo_flujo',
  })
  subtype: DbFlowSubtype;

  @Column({ name: 'monto', type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'fecha', type: 'date' })
  date: string;

  @Column({ name: 'hora', type: 'time', nullable: true })
  time: string | null;

  @Column({ name: 'concepto', type: 'varchar', length: 120 })
  concept: string;

  @Column({
    name: 'alias_comercial',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  merchant: string | null;

  @Column({ name: 'notas', type: 'text', nullable: true })
  notes: string | null;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: ['efectivo', 'transferencia', 'tarjeta'],
    enumName: 'metodo_pago',
  })
  paymentMethod: DbPaymentMethod;

  @Column({
    name: 'nivel_alerta',
    type: 'enum',
    enum: ['ninguna', 'preventiva', 'excedida'],
    enumName: 'nivel_alerta',
  })
  alertLevel: DbAlertLevel;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
