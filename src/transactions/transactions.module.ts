import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { BalancesModule } from '../balances/balances.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CardsModule } from '../cards/cards.module';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentSourceResolver } from './payment-source.resolver';
import { Transaction } from './transaction.entity';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    AccountsModule,
    BalancesModule,
    BudgetsModule,
    CardsModule,
    CategoriesModule,
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsRepository,
    PaymentSourceResolver,
    TransactionsService,
  ],
  exports: [TransactionsService, TransactionsRepository, PaymentSourceResolver],
})
export class TransactionsModule {}
