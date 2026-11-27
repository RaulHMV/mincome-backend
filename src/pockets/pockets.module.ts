import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { BalancesModule } from '../balances/balances.module';
import { Pocket } from './pocket.entity';
import { PocketMovement } from './pocket-movement.entity';
import { PocketsController } from './pockets.controller';
import { PocketsRepository } from './pockets.repository';
import { PocketsService } from './pockets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pocket, PocketMovement]),
    AccountsModule,
    BalancesModule,
  ],
  controllers: [PocketsController],
  providers: [PocketsRepository, PocketsService],
  exports: [PocketsService, PocketsRepository],
})
export class PocketsModule {}
