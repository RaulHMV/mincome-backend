import { Module } from '@nestjs/common';
import { BalancesRepository } from './balances.repository';
import { BalancesService } from './balances.service';

@Module({
  providers: [BalancesRepository, BalancesService],
  exports: [BalancesService],
})
export class BalancesModule {}
