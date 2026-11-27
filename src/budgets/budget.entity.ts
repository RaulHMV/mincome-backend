import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Una versión del límite de una categoría. El límite de un mes es la fila con
 * el vigente_desde más reciente que no pase de ese mes (requerimientos-backend.md §2.5).
 */
@Entity({ name: 'presupuestos', synchronize: false })
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'categoria_id', type: 'int' })
  categoryId: number;

  @Column({ name: 'monto_limite', type: 'numeric', precision: 12, scale: 2 })
  limit: string;

  @Column({ name: 'umbral_alerta', type: 'smallint' })
  alertThreshold: number;

  @Column({ name: 'activo', type: 'boolean' })
  isActive: boolean;

  /** Primer día del mes desde el que aplica. */
  @Column({ name: 'vigente_desde', type: 'date' })
  effectiveFrom: string;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
