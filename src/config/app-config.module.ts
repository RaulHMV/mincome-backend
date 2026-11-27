import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG, loadAppConfig } from './app-config';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        loadAppConfig((name) => configService.get<string>(name)),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
