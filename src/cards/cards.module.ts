import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { BalancesModule } from '../balances/balances.module';
import { Card } from './card.entity';
import { CardsController } from './cards.controller';
import { CardsRepository } from './cards.repository';
import { CardsService } from './cards.service';
import { Transfer } from './transfer.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Card, Transfer]),
    AccountsModule,
    BalancesModule,
  ],
  controllers: [CardsController],
  providers: [CardsRepository, CardsService],
  exports: [CardsService, CardsRepository],
})
export class CardsModule {}
