import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceAccount } from './entities/finance-account.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { FxRate } from './entities/fx-rate.entity';
import { CurrencyService } from './currency.service';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Organization } from '../organizations/entities/organization.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { CreditNote } from '../credits/entities/credit-note.entity';
import {
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { ExpensesService } from './expenses.service';
import { FinanceController } from './finance.controller';
import { ExpensesController } from './expenses.controller';
import { TemporalModule } from '../temporal/temporal.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinanceAccount,
      ExpenseClaim,
      CategoryBudget,
      RecurringExpense,
      JournalEntry,
      LedgerAccount,
      // Read by the currency and reporting services; owned elsewhere.
      FxRate,
      Organization,
      Invoice,
      Quote,
      SupplierBill,
      CreditNote,
      SalesOrder,
      SalesOrderLine,
      WorkOrder,
    ]),
    TemporalModule,
    AiModule,
  ],
  controllers: [FinanceController, ExpensesController, ReportsController],
  providers: [
    FinanceService,
    ExpensesService,
    LedgerService,
    CurrencyService,
    ReportsService,
  ],
  exports: [FinanceService, ExpensesService, LedgerService, CurrencyService],
})
export class FinanceModule {}
