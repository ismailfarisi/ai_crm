import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config/configuration';
import { MailService } from './mail.service';
import { MAIL_PROVIDER, type MailProvider } from './mail.types';
import { ConsoleMailProvider } from './providers/console-mail.provider';
import { SesMailProvider } from './providers/ses-mail.provider';

/**
 * Picks the active mail provider from `MAIL_PROVIDER` (console | ses). Add a
 * new provider: implement `MailProvider`, then add one case here.
 */
@Module({
  providers: [
    ConsoleMailProvider,
    SesMailProvider,
    {
      provide: MAIL_PROVIDER,
      useFactory: (
        config: ConfigService<AppConfig, true>,
        consoleProvider: ConsoleMailProvider,
        sesProvider: SesMailProvider,
      ): MailProvider => {
        const provider = config.get('mail.provider', { infer: true });
        switch (provider) {
          case 'ses':
            return sesProvider;
          case 'console':
          default:
            return consoleProvider;
        }
      },
      inject: [ConfigService, ConsoleMailProvider, SesMailProvider],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
