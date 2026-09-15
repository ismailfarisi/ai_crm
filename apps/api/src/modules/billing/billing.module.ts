import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { BillingController } from './billing.controller';
import { BillingGuard } from './billing.guard';
import { BillingService } from './billing.service';
import {
  BillingEvent,
  Plan,
  Subscription,
  SubscriptionItem,
} from './entities/billing.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      Subscription,
      SubscriptionItem,
      BillingEvent,
      User,
    ]),
    NotificationsModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingGuard],
  exports: [BillingService, BillingGuard],
})
export class BillingModule {}
