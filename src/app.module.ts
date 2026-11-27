import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { BudgetsModule } from './budgets/budgets.module';
import { CalendarModule } from './calendar/calendar.module';
import { CardsModule } from './cards/cards.module';
import { CategoriesModule } from './categories/categories.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import { AppConfigModule } from './config/app-config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConversationsModule } from './conversations/conversations.module';
import { createDatabaseConfig } from './database.config';
import { HealthModule } from './health/health.module';
import { IdempotencyKeysModule } from './idempotency/idempotency-keys.module';
import { MovementsModule } from './movements/movements.module';
import { PlansModule } from './plans/plans.module';
import { PocketsModule } from './pockets/pockets.module';
import { RecurringTransactionsModule } from './recurring-transactions/recurring-transactions.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UsersModule } from './users/users.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createDatabaseConfig(configService),
    }),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    // Apagado sin llaves: unas falsas se mandan igual y el colector las rechaza.
    // La Lambda está en la VPC sin NAT; para reportar necesita salida a internet.
    ObserveModule.forRoot({
      enabled: Boolean(
        process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
      ),
      appKey: process.env.OBSERVE_APP_KEY,
      appSecret: process.env.OBSERVE_APP_SECRET,
      serviceId: 'mincome-backend',
    }),
    IdempotencyKeysModule,
    AuthModule,
    HealthModule,
    PlansModule,
    UsersModule,
    CategoriesModule,
    AccountsModule,
    CardsModule,
    BudgetsModule,
    TransactionsModule,
    RecurringTransactionsModule,
    PocketsModule,
    MovementsModule,
    CalendarModule,
    DashboardModule,
    AlertsModule,
    ConversationsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
