import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DbCategoryAppliesTo } from '../common/enums';

@Entity({ name: 'categorias', synchronize: false })
export class Category {
  @PrimaryGeneratedColumn('identity', {
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id: number;

  /** Nulo en las categorías del sistema. */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'nombre', type: 'varchar', length: 50 })
  name: string;

  @Column({ name: 'icono', type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ name: 'tipo_aplicable', type: 'varchar', length: 10 })
  appliesTo: DbCategoryAppliesTo;

  @Column({ name: 'es_sistema', type: 'boolean' })
  isSystem: boolean;

  @Column({ name: 'activa', type: 'boolean' })
  isActive: boolean;
}
