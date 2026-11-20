import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// synchronize: false en todas las entidades. El esquema lo definen las
// migraciones escritas a mano (índices parciales y de expresión, FK compuestas
// y CHECK que las entidades no describen), y así `migration:generate` no
// propone borrarlos.

@Entity({ name: 'planes', synchronize: false })
export class Plan {
  @PrimaryGeneratedColumn('identity', {
    type: 'smallint',
    generatedIdentity: 'ALWAYS',
  })
  id: number;

  @Column({ name: 'nombre', type: 'varchar', length: 30 })
  name: string;

  @Column({ name: 'limite_consultas_mes', type: 'int' })
  monthlyQueryLimit: number;

  @Column({ name: 'limite_tokens_mes', type: 'int' })
  monthlyTokenLimit: number;

  @Column({ name: 'precio_mensual', type: 'numeric', precision: 8, scale: 2 })
  monthlyPrice: string;

  @Column({ name: 'incluye_asistente', type: 'boolean' })
  includesAssistant: boolean;

  @Column({ name: 'activo', type: 'boolean' })
  isActive: boolean;
}
