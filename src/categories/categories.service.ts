import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CATEGORY_APPLIES_TO_DB,
  CategoryAppliesTo,
  FLOW_TYPE_DB,
  FlowType,
  type DbCategoryAppliesTo,
} from '../common/enums';
import {
  ConflictError,
  NotEditableError,
  NotFoundError,
  ValidationError,
} from '../common/errors/api-error';
import { CategoriesRepository } from './categories.repository';
import type { Category } from './category.entity';
import { toCategoryDto, type CategoryDto } from './category.mapper';
import type {
  CreateCategoryDto,
  ListCategoriesQuery,
  UpdateCategoryDto,
} from './dto/category.dto';

/** `ambos` acepta los dos flujos (requerimientos-backend.md §4). */
export function categoryAccepts(
  appliesTo: DbCategoryAppliesTo,
  type: FlowType,
): boolean {
  // tipo_aplicable usa las mismas palabras que tipo_flujo: 'ingreso' y 'gasto'.
  return (
    appliesTo === CATEGORY_APPLIES_TO_DB[CategoryAppliesTo.BOTH] ||
    appliesTo === FLOW_TYPE_DB[type]
  );
}

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepository: CategoriesRepository) {}

  async list(
    userId: string,
    query: ListCategoriesQuery,
  ): Promise<CategoryDto[]> {
    // income y expense incluyen las de "ambos"; both, solo esas.
    const appliesTo = query.appliesTo
      ? [
          ...new Set([
            CATEGORY_APPLIES_TO_DB[query.appliesTo],
            CATEGORY_APPLIES_TO_DB.both,
          ]),
        ]
      : null;
    const categories = await this.categoriesRepository.findVisible(userId, {
      appliesTo,
      includeInactive: query.includeInactive,
    });
    return categories.map(toCategoryDto);
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    if (await this.categoriesRepository.isNameTaken(userId, dto.name)) {
      throw new ConflictError('Ya tienes una categoría con ese nombre.', {
        name: 'Ya existe una categoría con ese nombre',
      });
    }
    const id = await this.categoriesRepository.insert({
      userId,
      name: dto.name,
      icon: dto.icon,
      appliesTo: CATEGORY_APPLIES_TO_DB[dto.appliesTo],
    });
    return toCategoryDto(await this.findOwned(userId, id));
  }

  async update(
    userId: string,
    categoryId: number,
    dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    const category = await this.categoriesRepository.findAccessible(
      userId,
      categoryId,
    );
    if (!category) {
      throw new NotFoundError();
    }
    if (category.isSystem) {
      throw new NotEditableError(
        'Las categorías del sistema no se pueden editar.',
      );
    }
    if (
      dto.name &&
      (await this.categoriesRepository.isNameTaken(
        userId,
        dto.name,
        categoryId,
      ))
    ) {
      throw new ConflictError('Ya tienes una categoría con ese nombre.', {
        name: 'Ya existe una categoría con ese nombre',
      });
    }
    await this.categoriesRepository.update(categoryId, dto);
    return toCategoryDto(await this.findOwned(userId, categoryId));
  }

  /**
   * Para movimientos y presupuestos nuevos: del sistema o del usuario,
   * activa y compatible con el flujo (requerimientos-backend.md §4).
   */
  /** Con el manager de la transacción en curso, para no pedir otra conexión al pool. */
  async requireUsable(
    manager: EntityManager,
    userId: string,
    categoryId: number,
    type: FlowType,
    field = 'categoryId',
  ): Promise<Category> {
    const category = await this.categoriesRepository.findAccessible(
      userId,
      categoryId,
      manager,
    );
    if (!category) {
      throw ValidationError.forField(field, 'La categoría no existe');
    }
    if (!category.isActive) {
      throw ValidationError.forField(field, 'La categoría está oculta');
    }
    if (!categoryAccepts(category.appliesTo, type)) {
      throw ValidationError.forField(
        field,
        type === FlowType.INCOME
          ? 'La categoría no es de ingresos'
          : 'La categoría no es de gastos',
      );
    }
    return category;
  }

  private async findOwned(
    userId: string,
    categoryId: number,
  ): Promise<Category> {
    const category = await this.categoriesRepository.findAccessible(
      userId,
      categoryId,
    );
    if (!category) {
      throw new NotFoundError();
    }
    return category;
  }
}
