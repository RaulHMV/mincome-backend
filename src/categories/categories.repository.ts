import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { DbCategoryAppliesTo } from '../common/enums';
import { Category } from './category.entity';

const CATEGORY_COLUMNS = `id, usuario_id AS "userId", nombre AS name, icono AS icon,
  tipo_aplicable AS "appliesTo", es_sistema AS "isSystem", activa AS "isActive"`;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Las del sistema primero (en el orden de la semilla) y luego las del usuario por nombre. */
  findVisible(
    userId: string,
    filters: {
      appliesTo: DbCategoryAppliesTo[] | null;
      includeInactive: boolean;
    },
  ): Promise<Category[]> {
    return this.dataSource.query(
      `SELECT ${CATEGORY_COLUMNS}
       FROM categorias
       WHERE (usuario_id = $1 OR usuario_id IS NULL)
         AND ($2::varchar[] IS NULL OR tipo_aplicable = ANY($2))
         AND ($3 OR activa)
       ORDER BY es_sistema DESC, CASE WHEN es_sistema THEN id END, lower(nombre), id`,
      [userId, filters.appliesTo, filters.includeInactive],
    );
  }

  /** Una categoría del sistema o del usuario; null si no existe o es de otro usuario. */
  async findAccessible(
    userId: string,
    categoryId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Category | null> {
    const rows: Category[] = await manager.query(
      `SELECT ${CATEGORY_COLUMNS}
       FROM categorias
       WHERE id = $2 AND (usuario_id = $1 OR usuario_id IS NULL)`,
      [userId, categoryId],
    );
    return rows[0] ?? null;
  }

  /**
   * ¿Ya existe ese nombre, sin distinguir mayúsculas, entre las del sistema o
   * las del usuario? Así el formulario no muestra "comida" y "Comida".
   */
  async isNameTaken(
    userId: string,
    name: string,
    exceptId?: number,
  ): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM categorias
       WHERE (usuario_id = $1 OR usuario_id IS NULL)
         AND lower(nombre) = lower($2)
         AND ($3::int IS NULL OR id <> $3)
       LIMIT 1`,
      [userId, name, exceptId ?? null],
    );
    return rows.length > 0;
  }

  async insert(
    category: Pick<Category, 'userId' | 'name' | 'icon' | 'appliesTo'>,
  ): Promise<number> {
    const result = await this.dataSource.manager.insert(Category, {
      ...category,
      isSystem: false,
    });
    return Number(result.identifiers[0].id);
  }

  async update(
    categoryId: number,
    changes: Partial<Pick<Category, 'name' | 'icon' | 'isActive'>>,
  ): Promise<void> {
    if (Object.keys(changes).length > 0) {
      await this.dataSource.manager.update(
        Category,
        { id: categoryId },
        changes,
      );
    }
  }
}
