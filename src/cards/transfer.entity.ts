import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Dinero que pasa de una cuenta a otra; no es ingreso ni gasto (requerimientos-backend.md §2.2). */
@Entity({ name: 'traspasos', synchronize: false })
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'cuenta_origen_id', type: 'uuid' })
  sourceAccountId: string;

  @Column({ name: 'cuenta_destino_id', type: 'uuid' })
  destinationAccountId: string;

  @Column({ name: 'monto', type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'fecha', type: 'date' })
  date: string;

  @Column({ name: 'nota', type: 'varchar', length: 200, nullable: true })
  note: string | null;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;
}
