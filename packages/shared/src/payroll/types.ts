export type EmployeeStatus = 'ACTIVE' | 'ON_HOLD' | 'LEFT';
export type PaymentMethod = 'BANK' | 'CASH';

export interface EmployeeDto {
  id: string; employeeNumber: string; firstName: string; lastName: string; fullName: string;
  jobTitle: string | null; department: string | null; userId: string | null;
  joiningDate: string; leavingDate: string | null; status: EmployeeStatus;
  nationality: string | null; isNational: boolean; paymentMethod: PaymentMethod;
  bankName: string | null;
  /** Full IBAN — only for employee:manage holders. */
  iban?: string | null;
  ibanMasked: string | null;
  email: string | null; phone: string | null;
  /** Present only for payroll:read holders. */
  currentPackage?: SalaryPackageDto | null;
  createdAt: string; updatedAt: string;
}

export interface SalaryPackageDto { id: string; employeeId: string; effectiveFrom: string; basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number; createdAt: string; }
export interface EmployeeAdvanceDto { id: string; employeeId: string; amount: number; issuedAt: string; financeAccountId: string; note: string | null; createdAt: string; }
export interface EmployeeAdvancesDto { advances: EmployeeAdvanceDto[]; recovered: number; outstanding: number; }
export type GratuityEntryKind = 'OPENING' | 'ACCRUAL' | 'ADJUSTMENT' | 'REVERSAL';
export interface GratuityLedgerEntryDto { id: string; kind: GratuityEntryKind; amount: number; asOf: string; runLineId: string | null; note: string | null; createdAt: string; }
export interface EmployeeGratuityDto { balance: number; entitlementToday: number; serviceDaysToday: number; entries: GratuityLedgerEntryDto[]; }

export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED';
export interface PayrollRunLineDto {
  id: string; employeeId: string; employeeName: string; employeeNumber: string; paymentMethod: PaymentMethod; isNational: boolean;
  basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number;
  daysEmployed: number; daysInMonth: number; proratedGross: number;
  overtimeHours: number; overtimeHoursPremium: number; overtimeAmount: number;
  bonusAmount: number; bonusLabel: string | null;
  unpaidLeaveDays: number; unpaidLeaveAmount: number;
  advanceRecovery: number; otherDeductionAmount: number; otherDeductionLabel: string | null;
  salaryCost: number; netPay: number;
  gratuityBefore: number | null; gratuityAccrual: number | null; gratuityAfter: number | null;
  flags: string[]; paidAt: string | null;
}
export interface PayrollRunTotalsDto { salaryCost: number; overtime: number; bonus: number; unpaidLeave: number; advanceRecovery: number; otherDeductions: number; net: number; gratuityAccrual: number; bankNet: number; cashNet: number; }
export interface PayrollRunDto {
  id: string; runNumber: string; period: string; payDate: string; status: PayrollRunStatus;
  totals: PayrollRunTotalsDto; bankPaidAt: string | null; cashPaidAt: string | null;
  approvedAt: string | null; approvedById: string | null; journalEntryId: string | null;
  lines?: PayrollRunLineDto[]; createdAt: string; updatedAt: string;
}
export interface OpeningGratuityPreviewDto { cutoverDate: string; lines: { employeeId: string; employeeName: string; joiningDate: string; basic: number; serviceDays: number; calculated: number }[]; }
export interface PayslipDto { run: Pick<PayrollRunDto, 'id' | 'runNumber' | 'period' | 'payDate' | 'status'>; line: PayrollRunLineDto; employee: Pick<EmployeeDto, 'id' | 'employeeNumber' | 'fullName' | 'jobTitle' | 'department' | 'joiningDate' | 'paymentMethod' | 'bankName' | 'ibanMasked'>; organization: { name: string; legalName: string | null; address: string | null; baseCurrency: string }; }
