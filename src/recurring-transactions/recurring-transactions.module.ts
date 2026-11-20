import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { RecurringTransaction } from './recurring-transaction.entity';
import { RecurringTransactionsController } from './recurring-transactions.controller';
import { RecurringTransactionsRepository } from './recurring-transactions.repository';
import { RecurringTransactionsService } from './recurring-transactions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringTransaction]),
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [RecurringTransactionsController],
  providers: [RecurringTransactionsRepository, RecurringTransactionsService],
  exports: [RecurringTransactionsService, RecurringTransactionsRepository],
})
export class RecurringTransactionsModule {}
