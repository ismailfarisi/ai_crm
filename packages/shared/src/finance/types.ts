export type { JournalLineDto } from './ledger';
import type { JournalLineDto, JournalReferenceType } from './ledger';
import type { VatTreatment } from '../tax/uae';
import type { RecurringInterval } from './recurring';

export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
} as const;

export type FinancePermission = (typeof FINANCE_PERMISSIONS)[keyof typeof FINANCE_PERMISSIONS];

export type AccountType = 'BANK' | 'CASH' | 'CREDIT_CARD' | 'CLEARING';
export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface FinanceAccountDto {
  id: string;
  tenantId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  accountNumber?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExpenseClaimDto {
  id: string;
  tenantId: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
  merchantName?: string | null;
  expenseDate: string;
  receiptUrl?: string | null;
  /** What the claimant wrote about it: the business purpose, who was there. */
  notes?: string | null;
  rejectionReason?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  reimbursedAt?: string | null;
  temporalWorkflowId?: string | null;
  items: ExpenseItemDto[];
  /** The purchase tax code for the VAT on the receipt. Null means no VAT. */
  taxCodeId?: string | null;
  /** The VAT inside `amount`, as the receipt shows it. */
  taxAmount?: number;
  /** The supplier's tax number (TRN) printed on the receipt. */
  supplierTaxId?: string | null;
  /** The VAT claimed back, fixed when the claim was approved. */
  recoverableTax?: number;
  /** VAT self-assessed on a reverse-charge claim, fixed at approval. */
  reverseChargeTax?: number;
  /** When the claim reached the books, which is the tax period it falls in. */
  taxPostedAt?: string | null;
  /** When an approved claim was rejected and its posting reversed. */
  taxReversedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A purchase tax code as the claim form offers it. */
export interface ExpenseTaxOptionDto {
  id: string;
  code: string;
  name: string;
  rate: number;
  isReverseCharge: boolean;
  /** UAE VAT treatment; null outside UAE VAT mode. */
  treatment: VatTreatment | null;
  /** False for a code switched off since: shown on old claims, not offered. */
  isActive: boolean;
}

export interface ExpenseTaxOptionsDto {
  codes: ExpenseTaxOptionDto[];
  /**
   * True in UAE VAT mode, where VAT can only be claimed back with the
   * supplier's 15-digit tax number (TRN) from the receipt.
   */
  supplierTaxIdRequired: boolean;
}

export interface CategoryBudgetDto {
  id: string;
  tenantId: string;
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount: number;
  alertThresholdPercent: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  supplierId: string | null;
  supplierName: string | null;
  vendorName: string;
  category: string;
  amount: number;
  currency: string | null;
  billingInterval: RecurringInterval;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string;
  taxCodeId: string | null;
  autoApprove: boolean;
  spreadOverPeriod: boolean;
  financeAccountId?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  /** Status of the most recent occurrence, for the table badge. */
  lastOccurrenceStatus: 'GENERATED' | 'FAILED' | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrenceDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  billId: string | null;
  billNumber: string | null;
  status: 'GENERATED' | 'FAILED';
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface PrepaidScheduleDto {
  id: string;
  billId: string;
  billLineId: string;
  expenseRole: string;
  totalBase: number;
  firstMonth: string;
  months: number;
  releasedMonths: number;
  releasedAmount: number;
  remainingAmount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY';
}

export interface CashForecastMonthDto {
  month: string; // YYYY-MM
  opening: number;
  inflows: number;
  billsOut: number;
  recurringOut: number;
  payrollOut: number;
  /** Pension contributions due to the fund. */
  pensionOut: number;
  closing: number;
}

export interface CashForecastDto {
  baseCurrency: string;
  months: CashForecastMonthDto[];
}

export interface JournalEntryDto {
  id: string;
  tenantId: string;
  entryNumber: string;
  referenceType: JournalReferenceType;
  referenceId: string;
  entryDate: string;
  lines: JournalLineDto[];
  totalAmount: number;
  /** Why a manual journal was posted. Null on entries a document posted. */
  memo?: string | null;
  createdById?: string | null;
  /** The entry this one reverses, for a reversal. */
  reversesEntryId?: string | null;
  currency?: string | null;
  fxRate?: number;
  createdAt: string;
}

export interface TreasuryOverviewDto {
  totalCash: number;
  currency: string;
  monthlyInflow: number;
  monthlyOutflow: number;
  netCashflow: number;
  monthlyBurnRate: number;
  runwayMonths: number;
  accounts: FinanceAccountDto[];
  recentCashflowSeries: Array<{
    date: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
}

export function calculateRunwayMonths(totalCash: number, monthlyBurnRate: number): number {
  if (monthlyBurnRate <= 0) return Infinity;
  return Math.round((totalCash / monthlyBurnRate) * 10) / 10;
}

export interface CreateFinanceAccountPayload {
  name: string;
  accountType: AccountType;
  currency?: string;
  balance?: number;
  accountNumber?: string | null;
  isDefault?: boolean;
}

/** Renaming an account, or moving the default flag onto it. */
export interface UpdateFinanceAccountPayload {
  name?: string;
  accountNumber?: string | null;
  isDefault?: boolean;
}

export interface TransferFundsPayload {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  /**
   * What arrived, in the destination account's currency, when the two
   * accounts hold different currencies. The bank did the conversion; this is
   * the only honest record of its rate.
   */
  toAmount?: number;
  description?: string;
}

export interface TransferFundsResult {
  fromAccount: FinanceAccountDto;
  toAccount: FinanceAccountDto;
  journalEntry: JournalEntryDto;
}

export interface CreateCategoryBudgetPayload {
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount?: number;
  alertThresholdPercent?: number;
  startDate: string;
  endDate: string;
}

/** A claim's notes are a paragraph, not a document. */
export const EXPENSE_NOTES_MAX_LENGTH = 2000;

export interface CreateExpenseClaimPayload {
  claimNumber?: string;
  employeeId?: string;
  employeeName?: string;
  category: string;
  amount: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string;
  receiptUrl?: string | null;
  notes?: string | null;
  items?: ExpenseItemDto[];
  /** A purchase tax code; null or left out means no VAT. */
  taxCodeId?: string | null;
  /** The VAT inside `amount`. Left out, it is worked out from the code's rate. */
  taxAmount?: number | null;
  supplierTaxId?: string | null;
  status?: ExpenseStatus;
}

export interface UpdateExpenseClaimPayload {
  employeeId?: string;
  employeeName?: string;
  category?: string;
  amount?: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string;
  receiptUrl?: string | null;
  notes?: string | null;
  rejectionReason?: string | null;
  items?: ExpenseItemDto[];
  /** A purchase tax code; null or left out means no VAT. */
  taxCodeId?: string | null;
  /** The VAT inside `amount`. Left out, it is worked out from the code's rate. */
  taxAmount?: number | null;
  supplierTaxId?: string | null;
  status?: ExpenseStatus;
}

export interface ScanReceiptPayload {
  imageUrl?: string;
  base64?: string;
  mimeType?: string;
  rawText?: string;
}

export interface ScannedReceiptResult {
  merchantName: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string;
  taxAmount?: number;
  /** The supplier's tax number (TRN) as printed on the receipt. */
  supplierTaxId?: string | null;
  /**
   * The purchase tax code the VAT on the receipt can be claimed under, when
   * the receipt shows both VAT and the supplier's tax number.
   */
  taxCodeId?: string | null;
  confidence: number;
  items: ExpenseItemDto[];
  rawText?: string;
}

export interface SignalExpenseClaimPayload {
  action: 'APPROVE' | 'REJECT' | 'REIMBURSE';
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  accountId?: string;
  reimbursedBy?: string;
  notes?: string;
}

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  status?: ExpenseStatus;
  category?: string;
  employeeId?: string;
  search?: string;
}

