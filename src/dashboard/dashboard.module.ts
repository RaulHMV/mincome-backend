import { Module } from '@nestjs/common';
import { BalancesModule } from '../balances/balances.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CardsModule } from '../cards/cards.module';
import { MovementsModule } from '../movements/movements.module';
import { PocketsModule } from '../pockets/pockets.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    BalancesModule,
    BudgetsModule,
    CardsModule,
    PocketsModule,
    MovementsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
