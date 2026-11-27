import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DbPocketMovementType } from '../common/enums';

@Entity({ name: 'movimientos_apartado', synchronize: false })
export class PocketMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'apartado_id', type: 'uuid' })
  pocketId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  userId: string;

  /** De dónde sale el abono o a dónde regresa el retiro. */
  @Column({ name: 'cuenta_id', type: 'uuid' })
  accountId: string;

  @Column({
    name: 'tipo',
    type: 'enum',
    enum: ['abono', 'retiro'],
    enumName: 'tipo_mov_apartado',
  })
  type: DbPocketMovementType;

  @Column({ name: 'monto', type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'fecha', type: 'date' })
  date: string;

  @Column({ name: 'nota', type: 'varchar', length: 200, nullable: true })
  note: string | null;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;
}
