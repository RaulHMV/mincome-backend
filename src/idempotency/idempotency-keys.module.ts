import {
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IdempotencyEvents, IdempotencyModule } from '@nestjs/idempotency';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Subscription } from 'rxjs';
import type { AuthUser } from '../auth/auth-user';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IdempotencyKey } from './idempotency-key.entity';
import { TypeOrmIdempotencyStore } from './typeorm-idempotency.store';

/**
 * Un candado perdido significa que el resultado no quedó guardado y un
 * reintento podría repetir la operación: se avisa en los logs.
 */
@Injectable()
export class IdempotencyEventsLogger implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Idempotency');
  private subscription?: Subscription;

  constructor(private readonly events: IdempotencyEvents) {}

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      if (event.type === 'lock-lost') {
        this.logger.warn(
          `Lock lost during ${event.phase} in ${event.handler}; a retry may run it again`,
        );
      }
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([IdempotencyKey]),
    IdempotencyModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        // Cada usuario tiene su propio espacio de llaves: la llave de uno nunca
        // devuelve la respuesta de otro.
        scope: (request: { user?: AuthUser }) => request.user?.id,
        // Las respuestas guardadas traen datos financieros.
        ...(config.idempotencyEncryptionKeys.length > 0
          ? { encryption: { keys: config.idempotencyEncryptionKeys } }
          : {}),
        ttl: '24h',
        lockTtl: '60s',
        retryAfter: '1s',
      }),
    }),
  ],
  providers: [TypeOrmIdempotencyStore, IdempotencyEventsLogger],
  exports: [TypeOrmIdempotencyStore],
})
export class IdempotencyKeysModule {}
