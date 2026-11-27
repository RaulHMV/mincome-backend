import {
  CATEGORY_APPLIES_TO_DB,
  CategoryAppliesTo,
  fromDb,
} from '../common/enums';
import type { Category } from './category.entity';

/** Contrato §2, `Category`. */
export interface CategoryDto {
  id: number;
  name: string;
  icon: string | null;
  appliesTo: CategoryAppliesTo;
  isSystem: boolean;
  isActive: boolean;
}

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    appliesTo: fromDb(CATEGORY_APPLIES_TO_DB, category.appliesTo),
    isSystem: category.isSystem,
    isActive: category.isActive,
  };
}
