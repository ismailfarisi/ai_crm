import type { EmployeeStatus } from '../payroll/types';
import type { WorkOrderOperationStatus, WorkOrderStatus } from '../production/work-orders';

export const TIMESHEET_INDIRECT_CATEGORIES = ['CLEANING', 'MAINTENANCE', 'TRAINING', 'IDLE', 'OTHER'] as const;
export type TimesheetIndirectCategory = (typeof TIMESHEET_INDIRECT_CATEGORIES)[number];
export type TimesheetSource = 'MANUAL' | 'CLOCK';

export interface TimesheetEntryDto {
  id: string; employeeId: string; employeeName: string; employeeNumber: string;
  workDate: string; hours: number;
  workOrderId: string | null; woNumber: string | null; operationId: string | null; operationLabel: string | null;
  indirectCategory: TimesheetIndirectCategory | null;
  source: TimesheetSource; note: string | null;
  /** True once the month's payroll has posted. */
  locked: boolean;
  /** True once the month's labour has been absorbed into the job. */
  absorbed: boolean;
}

export interface TimesheetEmployeeDto {
  id: string; employeeNumber: string; name: string; status: EmployeeStatus;
  joiningDate: string; leavingDate: string | null; userId: string | null;
}

export interface TimesheetOperationOptionDto {
  workOrderId: string; woNumber: string; workOrderStatus: WorkOrderStatus; description: string;
  operationId: string; operationLabel: string; operationStatus: WorkOrderOperationStatus;
}

export interface LabourUtilisationRowDto {
  employeeId: string; employeeNumber: string; employeeName: string;
  standardHours: number; directHours: number;
  indirectHours: Record<TimesheetIndirectCategory, number>;
  unloggedHours: number; cost: number; absorbed: number; unabsorbed: number;
}

export interface LabourUtilisationDto {
  period: string;
  status: 'ACTUAL' | 'PROVISIONAL';
  rows: LabourUtilisationRowDto[];
  totals: Omit<LabourUtilisationRowDto, 'employeeId' | 'employeeNumber' | 'employeeName'>;
}
