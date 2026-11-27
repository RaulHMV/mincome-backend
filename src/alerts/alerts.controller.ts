import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import type { AlertDto } from './alert.calculator';
import { AlertsService } from './alerts.service';
import { updateAlertSchema, type UpdateAlertDto } from './dto/alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /** Lo más urgente primero. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AlertDto[]> {
    return this.alertsService.list(user);
  }

  @Patch(':alertId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('alertId') alertId: string,
    @Body({ schema: updateAlertSchema }) dto: UpdateAlertDto,
  ): Promise<AlertDto> {
    return this.alertsService.update(user, alertId, dto.isRead);
  }
}
