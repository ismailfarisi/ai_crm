import { Module } from '@nestjs/common';
import { ApprovalNotifierService } from './approval-notifier.service';

/**
 * The write side of approval notices, light enough for any module (and the
 * Temporal worker) to import. Delivery lives in ApprovalNotificationsModule.
 */
@Module({
  providers: [ApprovalNotifierService],
  exports: [ApprovalNotifierService],
})
export class ApprovalNotifierModule {}
