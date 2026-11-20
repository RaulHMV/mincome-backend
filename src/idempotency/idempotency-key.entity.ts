import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Lee BIGINT como número: TypeORM lo entrega como texto. */
const epochMs = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

/** Un registro de @nestjs/idempotency: un candado en curso o una respuesta guardada. */
@Entity({ name: 'llaves_idempotencia', synchronize: false })
@Index('idx_llaves_idempotencia_expira_en', ['expiresAt'])
export class IdempotencyKey {
  /** SHA-256 de la llave: puede ser más larga de lo que admite una entrada de índice. */
  @PrimaryColumn({ name: 'llave_hash', type: 'text' })
  keyHash: string;

  @Column({ name: 'llave', type: 'text' })
  key: string;

  @Column({ name: 'huella', type: 'text' })
  fingerprint: string;

  /** El intento que tiene el candado; nulo cuando ya hay respuesta. */
  @Column({ name: 'propietario', type: 'text', nullable: true })
  owner: string | null;

  /** Un IdempotencyStoredPayload; `object` porque su body `unknown` no cabe en los tipos de TypeORM. */
  @Column({ name: 'respuesta', type: 'json', nullable: true })
  response: object | null;

  /** Milisegundos desde epoch. */
  @Column({ name: 'expira_en', type: 'bigint', transformer: epochMs })
  expiresAt: number;
}
