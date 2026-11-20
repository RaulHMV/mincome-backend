import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlansModule } from '../plans/plans.module';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), PlansModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
