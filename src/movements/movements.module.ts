import { Module } from '@nestjs/common';
import { MovementsController } from './movements.controller';
import { MovementsRepository } from './movements.repository';
import { MovementsService } from './movements.service';

@Module({
  controllers: [MovementsController],
  providers: [MovementsRepository, MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
