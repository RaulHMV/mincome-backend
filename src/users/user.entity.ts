import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'usuarios', synchronize: false })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: 'smallint' })
  planId: number;

  @Column({ name: 'nombre', type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'correo', type: 'varchar', length: 254 })
  email: string;

  @Column({ name: 'cognito_sub', type: 'varchar', length: 64 })
  cognitoSub: string;

  @Column({ name: 'moneda', type: 'char', length: 3 })
  currency: string;

  @Column({ name: 'zona_horaria', type: 'varchar', length: 40 })
  timeZone: string;

  @Column({
    name: 'terminos_version',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  termsVersion: string | null;

  @Column({
    name: 'terminos_aceptados_en',
    type: 'timestamptz',
    nullable: true,
  })
  termsAcceptedAt: Date | null;

  @Column({ name: 'activo', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'ultimo_acceso', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'creado_en', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actualizado_en', type: 'timestamptz' })
  updatedAt: Date;
}
