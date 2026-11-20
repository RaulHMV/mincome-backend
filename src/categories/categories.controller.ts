import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { ParseIntIdPipe } from '../common/validation/id.pipes';
import { CategoriesService } from './categories.service';
import type { CategoryDto } from './category.mapper';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
  type CreateCategoryDto,
  type ListCategoriesQuery,
  type UpdateCategoryDto,
} from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listCategoriesQuerySchema }) query: ListCategoriesQuery,
  ): Promise<CategoryDto[]> {
    return this.categoriesService.list(user.id, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createCategorySchema }) dto: CreateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categoriesService.create(user.id, dto);
  }

  @Patch(':categoryId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('categoryId', ParseIntIdPipe) categoryId: number,
    @Body({ schema: updateCategorySchema }) dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categoriesService.update(user.id, categoryId, dto);
  }
}
