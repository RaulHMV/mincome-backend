import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import type { BalanceProjection } from './calendar.calculator';
import { CalendarService, type CalendarDto } from './calendar.service';
import {
  balanceProjectionQuerySchema,
  calendarQuerySchema,
  type BalanceProjectionQuery,
  type CalendarQuery,
} from './dto/calendar.dto';

@Controller()
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('calendar')
  forMonth(
    @CurrentUser() user: AuthUser,
    @Query({ schema: calendarQuerySchema }) query: CalendarQuery,
  ): Promise<CalendarDto> {
    return this.calendarService.forMonth(user, query.month);
  }

  /** "Libre para gastar" del simulador; Piggy pide el mismo cálculo. */
  @Get('balance-projections')
  projection(
    @CurrentUser() user: AuthUser,
    @Query({ schema: balanceProjectionQuerySchema })
    query: BalanceProjectionQuery,
  ): Promise<BalanceProjection> {
    return this.calendarService.projection(user, query);
  }
}
