import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { todayIn } from '../common/dates';
import { PlanName } from '../common/enums';

export const DEFAULT_TIME_ZONE = 'America/Mexico_City';

export interface UserIdentityRow {
  id: string;
  cognitoSub: string;
  name: string;
  email: string;
  timeZone: string;
  isActive: boolean;
  plan: PlanName;
}

export interface NewUser {
  cognitoSub: string;
  email: string;
  name: string;
  termsVersion: string | null;
}

export interface ProfileChanges {
  name?: string;
  timeZone?: string;
  termsVersion?: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findIdentityBySub(cognitoSub: string): Promise<UserIdentityRow | null> {
    const rows: UserIdentityRow[] = await this.dataSource.query(
      `SELECT u.id, u.cognito_sub AS "cognitoSub", u.nombre AS name, u.correo AS email,
              u.zona_horaria AS "timeZone", u.activo AS "isActive", p.nombre AS plan
       FROM usuarios u
       JOIN planes p ON p.id = u.plan_id
       WHERE u.cognito_sub = $1`,
      [cognitoSub],
    );
    return rows[0] ?? null;
  }

  /**
   * Crea al usuario con plan normal y su cuenta "Efectivo" en saldo 0. No hace
   * nada si ya existe alguien con ese sub o ese correo: false en ese caso.
   */
  async create(user: NewUser): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows: { id: string }[] = await manager.query(
        `INSERT INTO usuarios (plan_id, nombre, correo, cognito_sub, zona_horaria,
                               terminos_version, terminos_aceptados_en)
         SELECT p.id, $1, $2, $3, $4, $5::varchar, CASE WHEN $5::varchar IS NULL THEN NULL ELSE now() END
         FROM planes p
         WHERE p.nombre = $6
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          user.name.slice(0, 100),
          user.email,
          user.cognitoSub,
          DEFAULT_TIME_ZONE,
          user.termsVersion?.slice(0, 20) ?? null,
          PlanName.NORMAL,
        ],
      );
      const created = rows[0];
      if (!created) {
        return false;
      }
      await manager.query(
        `INSERT INTO cuentas (usuario_id, nombre, tipo, saldo_inicial, fecha_saldo_inicial)
         VALUES ($1, 'Efectivo', 'efectivo', 0, $2)`,
        [created.id, todayIn(DEFAULT_TIME_ZONE)],
      );
      return true;
    });
  }

  async updatePlan(userId: string, plan: PlanName): Promise<void> {
    await this.dataSource.query(
      `UPDATE usuarios SET plan_id = p.id, actualizado_en = now()
       FROM planes p
       WHERE usuarios.id = $1 AND p.nombre = $2`,
      [userId, plan],
    );
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1`,
      [userId],
    );
  }

  async updateProfile(userId: string, changes: ProfileChanges): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [userId];
    if (changes.name !== undefined) {
      params.push(changes.name);
      sets.push(`nombre = $${params.length}`);
    }
    if (changes.timeZone !== undefined) {
      params.push(changes.timeZone);
      sets.push(`zona_horaria = $${params.length}`);
    }
    if (changes.termsVersion !== undefined) {
      params.push(changes.termsVersion);
      sets.push(
        `terminos_version = $${params.length}`,
        'terminos_aceptados_en = now()',
      );
    }
    if (sets.length === 0) {
      return;
    }
    await this.dataSource.query(
      `UPDATE usuarios SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $1`,
      params,
    );
  }

  async findProfile(userId: string) {
    const rows: {
      id: string;
      name: string;
      email: string;
      currency: string;
      timeZone: string;
      termsVersion: string | null;
      lastLoginAt: Date | null;
      createdAt: Date;
    }[] = await this.dataSource.query(
      `SELECT id, nombre AS name, correo AS email, moneda AS currency, zona_horaria AS "timeZone",
              terminos_version AS "termsVersion", ultimo_acceso AS "lastLoginAt", creado_en AS "createdAt"
       FROM usuarios WHERE id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }
}
