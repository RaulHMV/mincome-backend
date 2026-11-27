import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetsModule } from '../budgets/budgets.module';
import { CardsModule } from '../cards/cards.module';
import { PocketsModule } from '../pockets/pockets.module';
import { AlertsController } from './alerts.controller';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';
import { Notification } from './notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    BudgetsModule,
    CardsModule,
    PocketsModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsRepository, AlertsService],
})
export class AlertsModule {}
