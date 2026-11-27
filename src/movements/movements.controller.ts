import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import {
  searchMovementsQuerySchema,
  type SearchMovementsQuery,
} from './dto/movement.dto';
import type { MovementPage } from './movement.mapper';
import { MovementsService } from './movements.service';

@Controller('movements')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  /** Orden: fecha y luego creación, del más reciente al más antiguo. */
  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @Query({ schema: searchMovementsQuerySchema }) query: SearchMovementsQuery,
  ): Promise<MovementPage> {
    return this.movementsService.search(user, query);
  }
}
