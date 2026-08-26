import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceAccount } from './entities/finance-account.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { FinanceService } from './finance.service';
import { ExpensesService } from './expenses.service';
import { FinanceController } from './finance.controller';
import { ExpensesController } from './expenses.controller';
import { TemporalModule } from '../temporal/temporal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinanceAccount,
      ExpenseClaim,
      CategoryBudget,
      RecurringExpense,
      JournalEntry,
    ]),
    TemporalModule,
  ],
  controllers: [FinanceController, ExpensesController],
  providers: [FinanceService, ExpensesService],
  exports: [FinanceService, ExpensesService],
})
export class FinanceModule {}
