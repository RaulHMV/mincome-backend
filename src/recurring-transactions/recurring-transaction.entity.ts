import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type {
  DbFlowSubtype,
  DbFlowType,
  DbFrequency,
  DbPaymentMethod,
} from '../common/enums';

@Entity({ name: 'transacciones_recurrentes', synchronize: false })
export class RecurringTransaction {
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

  @Column({ name: 'concepto', type: 'varchar', length: 120 })
  concept: string;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: ['efectivo', 'transferencia', 'tarjeta'],
    enumName: 'metodo_pago',
  })
  paymentMethod: DbPaymentMethod;

  @Column({
    name: 'frecuencia',
    type: 'enum',
    enum: ['semanal', 'quincenal', 'mensual', 'anual'],
    enumName: 'frecuencia',
  })
  frequency: DbFrequency;

  /** Solo en 'mensual'. */
  @Column({ name: 'dia_ejecucion', type: 'smallint', nullable: true })
  dayOfMonth: number | null;

  @Column({ name: 'fecha_inicio', type: 'date' })
  startDate: string;

  @Column({ name: 'fecha_fin', type: 'date', nullable: true })
  endDate: string | null;

  /** Nula cuando la plantilla terminó. */
  @Column({ name: 'proxima_ejecucion', type: 'date', nullable: true })
  nextRunDate: string | null;

  @Column({ name: 'activa', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
