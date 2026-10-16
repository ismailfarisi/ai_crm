import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';
import { PensionScheme } from './entities/pension-scheme.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { PensionRemittance } from './entities/pension-remittance.entity';
import { Settlement, SettlementLine } from './entities/settlement.entity';
import { PayrollCryptoService } from './payroll-crypto.service';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollController } from './payroll.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollPostingService } from './payroll-posting.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PensionRemittanceService } from './pension-remittance.service';
import { PensionService } from './pension.service';
import { PayrollComplianceController } from './payroll-compliance.controller';
import { LeaveService } from './leave.service';
import { LeaveRecordsService } from './leave-records.service';
import { LeaveController } from './leave.controller';

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
      PayrollSettings,
      PensionScheme,
      LeaveRecord,
      LeaveLedgerEntry,
      PensionRemittance,
      Settlement,
      SettlementLine,
    ]),
    // LedgerService posts the approval, payment, advance and gratuity journals.
    FinanceModule,
  ],
  controllers: [EmployeesController, PayrollController, PayrollRunsController, PayrollComplianceController, LeaveController],
  providers: [
    EmployeesService,
    AdvancesService,
    GratuityService,
    PayrollRunsService,
    PayrollPostingService,
    PayrollSettingsService,
    PensionService,
    PensionRemittanceService,
    LeaveService,
    LeaveRecordsService,
    // Built from process.env so a missing PAYROLL_DATA_KEY fails boot in production.
    {
      provide: PayrollCryptoService,
      useFactory: () => new PayrollCryptoService(process.env),
    },
  ],
})
export class PayrollModule {}
