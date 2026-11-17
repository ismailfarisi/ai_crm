import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StaffChannelIdentity } from '../channels/entities/staff-channel-identity.entity';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalNotifierModule } from './approval-notifier.module';
import { ApprovalNoticeDispatcherService } from './approval-notice-dispatcher.service';
import { ApprovalDelivery } from './entities/approval-delivery.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * Delivery of approval notices (API process only: it drains the outbox and
 * runs the reminder sweep) and the notification preferences screen.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest,
      ApprovalDelivery,
      NotificationPreference,
      StaffChannelIdentity,
    ]),
    ApprovalNotifierModule,
    ChannelsModule,
    MailModule,
    NotificationsModule,
  ],
  controllers: [NotificationPreferencesController],
  providers: [ApprovalNoticeDispatcherService, NotificationPreferencesService],
})
export class ApprovalNotificationsModule {}
