import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import { EmailAccount } from './entities/email-account.entity';
import { EmailAttachment } from './entities/email-attachment.entity';
import { EmailMessage } from './entities/email-message.entity';
import { EmailThread } from './entities/email-thread.entity';
import { EmailController } from './email.controller';
import { EmailIngestService } from './email-ingest.service';
import { EmailService } from './email.service';
import { EmailSyncService } from './email-sync.service';
import { GmailClientService } from './gmail/gmail-client.service';
import { GoogleOAuthService } from './gmail/google-oauth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmailAccount,
      EmailAttachment,
      EmailMessage,
      EmailThread,
      Contact,
    ]),
  ],
  controllers: [EmailController],
  providers: [
    ChannelCryptoService,
    EmailIngestService,
    EmailService,
    EmailSyncService,
    GmailClientService,
    GoogleOAuthService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
