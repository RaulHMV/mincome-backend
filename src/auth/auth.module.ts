import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from './auth.guard';
import { CognitoTokenVerifier, TOKEN_VERIFIER } from './cognito-token.verifier';
import { InternalApiGuard } from './internal-api.guard';
import { PremiumGuard } from './premium.guard';

@Module({
  imports: [UsersModule],
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new CognitoTokenVerifier(config.cognito),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    PremiumGuard,
    InternalApiGuard,
  ],
  exports: [TOKEN_VERIFIER, PremiumGuard, InternalApiGuard],
})
export class AuthModule {}
