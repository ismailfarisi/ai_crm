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
import { TaxModule } from '../tax/tax.module';
import { OccurrenceStore } from './occurrence.store';
import { AmortizationStore } from './amortization.store';
import { PrepaidService } from './prepaid.service';
import { PrepaidController } from './prepaid.controller';
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
    TaxModule,
  ],
  controllers: [PrepaidController],
  providers: [OccurrenceStore, AmortizationStore, PrepaidService, RecurringBillingService],
})
export class OverheadsModule {}
