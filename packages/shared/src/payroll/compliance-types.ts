import type { LeaveType } from './leave';
import type { PensionBase } from './pension';
import type { WpsEmployerIdType } from './wps';
import type { PaymentMethod } from './types';
import type { SettlementReason } from '../schemas/payroll-compliance';

export interface PayrollSettingsDto { wpsEnabled: boolean; employerIdType: WpsEmployerIdType | null; employerId: string | null; payerRoutingCode: string | null; annualLeaveDays: number; }

export interface PensionSchemeDto { id: string; name: string; presetKey: string | null; employeePct: number; employerPct: number; base: PensionBase; minSalary: number | null; maxSalary: number | null; isActive: boolean; assignedCount: number; createdAt: string; }

export interface LeaveRecordDto { id: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; days: number; note: string | null; createdAt: string; }
export type LeaveEntryKind = 'OPENING' | 'ACCRUAL' | 'TAKEN' | 'ADJUSTMENT' | 'ENCASHMENT' | 'REVERSAL';
export interface LeaveLedgerEntryDto { id: string; kind: LeaveEntryKind; days: number; amount: number | null; asOf: string; note: string | null; createdAt: string; }
export interface EmployeeLeaveDto {
  balanceDays: number;
  /** Statutory leave earned to today (for information). */
  accruedToDate: number;
  annualDays: number;
  /** Leave salary provision carried - present only for payroll:read holders. */
  provision?: number;
  records: LeaveRecordDto[];
  /** Amounts are stripped for callers without payroll:read. */
  entries: LeaveLedgerEntryDto[];
}
export interface OpeningLeavePreviewDto { cutoverDate: string; lines: { employeeId: string; employeeName: string; joiningDate: string; basic: number; serviceDays: number; calculatedDays: number }[]; }

export interface PensionRemittanceDto { id: string; period: string; amount: number; financeAccountId: string; paidAt: string; voidedAt: string | null; createdAt: string; }
export interface PensionPeriodDto {
  period: string;
  employeeTotal: number;
  employerTotal: number;
  due: number;
  lines: { employeeId: string; employeeName: string; schemeName: string | null; base: number; employee: number; employer: number }[];
  remittance: PensionRemittanceDto | null;
}

export type SettlementStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOIDED';
export type SettlementLineKind = 'GRATUITY' | 'LEAVE_ENCASHMENT' | 'NOTICE_PAY' | 'ADVANCE_RECOVERY' | 'ADDITION' | 'DEDUCTION';
export interface SettlementLineDto { id: string; kind: SettlementLineKind; label: string; quantity: number | null; rate: number | null; amount: number; }
export interface SettlementDto {
  id: string; settlementNumber: string; employeeId: string; employeeName: string; leavingDate: string;
  reason: SettlementReason; serviceDays: number; basic: number; gross: number; leaveBalanceDays: number;
  status: SettlementStatus; netPay: number; paymentMethod: PaymentMethod; financeAccountId: string | null;
  paidAt: string | null; approvedAt: string | null; journalEntryId: string | null;
  lines: SettlementLineDto[]; createdAt: string; updatedAt: string;
}
export interface SettlementStatementDto {
  settlement: SettlementDto;
  employee: { employeeNumber: string; fullName: string; jobTitle: string | null; joiningDate: string; ibanMasked: string | null; bankName: string | null };
  organization: { name: string; legalName: string | null; address: string | null; baseCurrency: string };
}

export interface WpsSifDto { fileName: string; content: string; warnings: string[]; }
