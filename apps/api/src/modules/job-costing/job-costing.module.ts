import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { Employee } from '../payroll/entities/employee.entity';
import { SalaryPackage } from '../payroll/entities/salary-package.entity';
import { PensionScheme } from '../payroll/entities/pension-scheme.entity';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import {
  PayrollRun,
  PayrollRunLine,
} from '../payroll/entities/payroll-run.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { WorkOrderLabour } from './entities/work-order-labour.entity';
import { JobCostService } from './job-cost.service';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';

/** Timesheets, labour absorbed by payroll, and the actual labour cost of jobs. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TimesheetEntry,
      WorkOrderLabour,
      WorkOrder,
      WorkOrderOperation,
      WorkOrderMaterial,
      Employee,
      SalaryPackage,
      PensionScheme,
      PayrollSettings,
      PayrollRun,
      PayrollRunLine,
    ]),
    // LedgerService posts the labour journals.
    FinanceModule,
  ],
  controllers: [TimesheetsController],
  providers: [TimesheetsService, JobCostService],
  // Production writes the clock's entries (recordClock) and recomputes jobs.
  exports: [TimesheetsService, JobCostService],
})
export class JobCostingModule {}
