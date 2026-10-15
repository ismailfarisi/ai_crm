import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';

/** Employees, salary packages, payroll runs, advances and the gratuity ledger. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      SalaryPackage,
      EmployeeAdvance,
      PayrollRun,
      PayrollRunLine,
      GratuityLedgerEntry,
    ]),
    // LedgerService posts the approval, payment, advance and gratuity journals.
    FinanceModule,
  ],
})
export class PayrollModule {}
