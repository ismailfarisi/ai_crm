import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringExpense } from '../finance/entities/recurring-expense.entity';
import { RecurringExpenseOccurrence } from '../finance/entities/recurring-expense-occurrence.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import {
  PrepaidAmortization,
  PrepaidSchedule,
} from '../payables/entities/prepaid-schedule.entity';
import { FinanceModule } from '../finance/finance.module';
import { PayablesModule } from '../payables/payables.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditModule } from '../audit/audit.module';
import { OccurrenceStore } from './occurrence.store';
import { RecurringBillingService } from './recurring-billing.service';

/** Overheads that post: recurring bills and prepaid release. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecurringExpense,
      RecurringExpenseOccurrence,
      JournalEntry,
      PrepaidSchedule,
      PrepaidAmortization,
    ]),
    FinanceModule,
    PayablesModule,
    NotificationsModule,
    RbacModule,
    AuditModule,
  ],
  providers: [OccurrenceStore, RecurringBillingService],
})
export class OverheadsModule {}
