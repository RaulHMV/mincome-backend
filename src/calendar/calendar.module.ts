import { Module } from '@nestjs/common';
import { BalancesModule } from '../balances/balances.module';
import { CardsModule } from '../cards/cards.module';
import { RecurringTransactionsModule } from '../recurring-transactions/recurring-transactions.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [RecurringTransactionsModule, CardsModule, BalancesModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
