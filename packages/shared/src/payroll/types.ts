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
  /** WPS person ID (14 digits). */
  wpsPersonId: string | null;
  /** The employee's bank routing code (9 digits), for the WPS file. */
  bankRoutingCode: string | null;
  pensionSchemeId: string | null;
  /** Overrides the tenant's annual leave days. */
  annualLeaveDaysOverride: number | null;
  probationEndDate: string | null;
  /** Present only for payroll:read holders. */
  currentPackage?: SalaryPackageDto | null;
  createdAt: string; updatedAt: string;
}

export interface SalaryPackageDto { id: string; employeeId: string; effectiveFrom: string; basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number; createdAt: string; }
export interface EmployeeAdvanceDto { id: string; employeeId: string; amount: number; issuedAt: string; financeAccountId: string; note: string | null; createdAt: string; }
export interface EmployeeAdvancesDto { advances: EmployeeAdvanceDto[]; recovered: number; outstanding: number; }
export type GratuityEntryKind = 'OPENING' | 'ACCRUAL' | 'ADJUSTMENT' | 'REVERSAL' | 'SETTLEMENT';
export interface GratuityLedgerEntryDto { id: string; kind: GratuityEntryKind; amount: number; asOf: string; runLineId: string | null; note: string | null; createdAt: string; }
export interface EmployeeGratuityDto {
  balance: number;
  /** The provision target today: statutory entitlement + Σ adjustments. */
  entitlementToday: number;
  /** The statutory part of entitlementToday. */
  statutoryEntitlementToday?: number;
  serviceDaysToday: number;
  entries: GratuityLedgerEntryDto[];
}

export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED';
export interface PayrollRunLineDto {
  id: string; employeeId: string; employeeName: string; employeeNumber: string; paymentMethod: PaymentMethod; isNational: boolean;
  basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number;
  daysEmployed: number; daysInMonth: number; proratedGross: number;
  overtimeHours: number; overtimeHoursPremium: number; overtimeAmount: number;
  bonusAmount: number; bonusLabel: string | null;
  unpaidLeaveDays: number; unpaidLeaveAmount: number;
  halfPayDays: number; halfPayAmount: number;
  annualLeaveDays: number; leaveDaysInPeriod: number;
  /** True once someone edited the leave days; refresh keeps them. */
  leaveOverridden: boolean;
  advanceRecovery: number; otherDeductionAmount: number; otherDeductionLabel: string | null;
  salaryCost: number; netPay: number;
  gratuityBefore: number | null; gratuityAccrual: number | null; gratuityAfter: number | null;
  pensionSchemeName: string | null; pensionBase: number; pensionEmployee: number; pensionEmployer: number;
  /** Null until approval computes the leave provision true-up. */
  leaveProvisionBefore: number | null; leaveProvisionChange: number | null; leaveProvisionAfter: number | null;
  /** Hours the labour rate divides by: pro-rated standard hours plus overtime. */
  standardHours: number; loggedHours: number; directHours: number; labourRate: number; labourAbsorbed: number;
  flags: string[]; paidAt: string | null;
}
export interface PayrollRunTotalsDto { salaryCost: number; overtime: number; bonus: number; unpaidLeave: number; advanceRecovery: number; otherDeductions: number; net: number; gratuityAccrual: number; halfPay: number; pensionEmployee: number; pensionEmployer: number; leaveProvision: number; bankNet: number; cashNet: number; labourAbsorbed: number; }
export interface PayrollRunDto {
  id: string; runNumber: string; period: string; payDate: string; status: PayrollRunStatus;
  totals: PayrollRunTotalsDto; bankPaidAt: string | null; cashPaidAt: string | null;
  approvedAt: string | null; approvedById: string | null; journalEntryId: string | null;
  lines?: PayrollRunLineDto[];
  /** Employees left out of a create or refresh, and why. */
  warnings?: string[];
  createdAt: string; updatedAt: string;
}
/** The runs list, plus the go-live gratuity cut-over (null until opening balances are posted). */
export interface PayrollRunsListDto { runs: PayrollRunDto[]; openingGratuityCutover: string | null; openingLeaveCutover: string | null; }
export interface OpeningGratuityPreviewDto { cutoverDate: string; lines: { employeeId: string; employeeName: string; joiningDate: string; basic: number; serviceDays: number; calculated: number }[]; }
export interface PayslipDto { run: Pick<PayrollRunDto, 'id' | 'runNumber' | 'period' | 'payDate' | 'status'>; line: PayrollRunLineDto; employee: Pick<EmployeeDto, 'id' | 'employeeNumber' | 'fullName' | 'jobTitle' | 'department' | 'joiningDate' | 'paymentMethod' | 'bankName' | 'ibanMasked'>; organization: { name: string; legalName: string | null; address: string | null; baseCurrency: string }; }
