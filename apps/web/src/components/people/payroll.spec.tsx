import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PayrollRunDto, PayrollRunLineDto, PayslipDto } from '@saas/shared';
import { PayrollRunDetail } from './payroll-run-detail';
import { Payslip } from './payslip-view';
import { OpeningGratuityView } from './opening-gratuity-view';
import { defaultNextPeriod } from './payroll-format';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/people/payroll' }));
vi.mock('@/hooks/use-finance', () => ({ useFinanceAccounts: () => ({ data: [] }) }));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

const line: PayrollRunLineDto = {
  id: 'l1', employeeId: 'e1', employeeName: 'Amina Khan', employeeNumber: 'EMP-0001', paymentMethod: 'BANK',
  isNational: false, basic: 5000, housing: 2000, transport: 500, otherAllowances: [], gross: 7500,
  daysEmployed: 31, daysInMonth: 31, proratedGross: 7500, overtimeHours: 0, overtimeHoursPremium: 0,
  overtimeAmount: 0, bonusAmount: 0, bonusLabel: null, unpaidLeaveDays: 0, unpaidLeaveAmount: 0,
  advanceRecovery: 0, otherDeductionAmount: 0, otherDeductionLabel: null, salaryCost: 7500, netPay: 7500,
  gratuityBefore: 0, gratuityAccrual: 100, gratuityAfter: 100, flags: [], paidAt: null,
};

function makeRun(over: Partial<PayrollRunDto> = {}): PayrollRunDto {
  return {
    id: 'r1', runNumber: 'PAY-0001', period: '2026-11', payDate: '2026-11-30', status: 'DRAFT',
    totals: { salaryCost: 7500, overtime: 0, bonus: 0, unpaidLeave: 0, advanceRecovery: 0, otherDeductions: 0, net: 7500, gratuityAccrual: 100, bankNet: 7500, cashNet: 0 },
    bankPaidAt: null, cashPaidAt: null, approvedAt: null, approvedById: null, journalEntryId: null,
    lines: [line], createdAt: '', updatedAt: '', ...over,
  };
}

let run = makeRun();
let saving = false;
let previewState = { isPlaceholderData: false, isFetching: false };
vi.mock('@/hooks/use-payroll', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    usePayrollRun: () => ({ data: run, isPending: false, isError: false, error: null }),
    useRefreshPayrollRun: mutation,
    useApprovePayrollRun: mutation,
    useVoidPayrollRun: mutation,
    usePayPayrollRun: mutation,
    useUpdatePayrollLine: mutation,
    usePayrollLinesSaving: () => saving,
    usePayrollRuns: () => ({ data: { runs: [], openingGratuityCutover: null } }),
    useOpeningGratuityPreview: () => ({
      data: {
        cutoverDate: '2026-09-30',
        lines: [{ employeeId: 'e1', employeeName: 'Amina Khan', joiningDate: '2024-01-01', basic: 5000, serviceDays: 100, calculated: 1200 }],
      },
      isPending: false,
      isError: false,
      ...previewState,
    }),
    usePostOpeningGratuity: mutation,
  };
});

beforeEach(() => {
  granted = new Set(['payroll:read']);
  run = makeRun();
  saving = false;
  previewState = { isPlaceholderData: false, isFetching: false };
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const btn = (name: RegExp) => screen.queryByRole('button', { name });

describe('PayrollRunDetail actions', () => {
  it('shows Refresh and Approve on a draft only with the matching permissions', () => {
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    expect(btn(/^refresh$/i)).toBeNull();
    expect(btn(/^approve$/i)).toBeNull();
    unmount();

    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/^refresh$/i)).not.toBeNull();
    expect(btn(/^approve$/i)).not.toBeNull();
    expect(btn(/pay bank/i)).toBeNull();
    expect(btn(/^void$/i)).toBeNull();
  });

  it('offers payment and void on an approved run, hiding a method with nobody to pay', () => {
    granted = new Set(['payroll:read', 'payroll:approve', 'payroll:pay']);
    run = makeRun({ status: 'APPROVED' });
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/pay bank/i)).not.toBeNull();
    expect(btn(/pay cash/i)).toBeNull();
    expect(btn(/^void$/i)).not.toBeNull();
    expect(btn(/^approve$/i)).toBeNull();
    expect(btn(/^refresh$/i)).toBeNull();
  });

  it('hides void once anything is paid and a paid method cannot be paid again', () => {
    granted = new Set(['payroll:read', 'payroll:approve', 'payroll:pay']);
    run = makeRun({
      status: 'PARTIALLY_PAID',
      bankPaidAt: '2026-11-30',
      totals: { ...makeRun().totals, cashNet: 300 },
    });
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/^void$/i)).toBeNull();
    expect(btn(/pay bank/i)).toBeNull();
    expect(btn(/pay cash/i)).not.toBeNull();
  });

  it('needs payroll:pay to show payment buttons', () => {
    granted = new Set(['payroll:read', 'payroll:approve']);
    run = makeRun({ status: 'APPROVED' });
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/pay bank/i)).toBeNull();
  });

  it('edits extras only while the run is a draft', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    expect(screen.getByLabelText('Bonus for Amina Khan')).toBeInTheDocument();
    unmount();

    run = makeRun({ status: 'APPROVED' });
    render(<PayrollRunDetail id="r1" />);
    expect(screen.queryByLabelText('Bonus for Amina Khan')).not.toBeInTheDocument();
  });

  it('disables Approve and Pay while a line update is saving', () => {
    granted = new Set(['payroll:read', 'payroll:approve', 'payroll:pay']);
    saving = true;
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    expect(btn(/^approve$/i)).toBeDisabled();
    unmount();
    run = makeRun({ status: 'APPROVED' });
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/pay bank/i)).toBeDisabled();
  });

  it('links each line to its payslip', () => {
    render(<PayrollRunDetail id="r1" />);
    expect(screen.getByRole('link', { name: /payslip for amina khan/i })).toHaveAttribute(
      'href',
      '/people/payroll/r1/payslips/l1',
    );
  });
});

describe('Payslip', () => {
  const slip: PayslipDto = {
    run: { id: 'r1', runNumber: 'PAY-0001', period: '2026-11', payDate: '2026-11-30', status: 'PAID' },
    line: { ...line, advanceRecovery: 500, netPay: 7000 },
    employee: {
      id: 'e1', employeeNumber: 'EMP-0001', fullName: 'Amina Khan', jobTitle: 'Designer', department: null,
      joiningDate: '2024-01-01', paymentMethod: 'BANK', bankName: 'ENBD', ibanMasked: 'AE07 **** 3456',
    },
    organization: { name: 'Acme', legalName: 'Acme LLC', address: null, baseCurrency: 'AED' },
  };

  it('shows the net pay and only the masked IBAN', () => {
    render(<Payslip slip={slip} />);
    expect(screen.getByTestId('payslip-net')).toHaveTextContent('AED 7,000.00');
    expect(screen.getByTestId('payslip-iban')).toHaveTextContent('AE07 **** 3456');
    expect(screen.getByText('Acme LLC')).toBeInTheDocument();
    expect(screen.getByText('Advance recovery')).toBeInTheDocument();
  });
});

describe('OpeningGratuityView', () => {
  it('disables Post without payroll:approve', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    render(<OpeningGratuityView />);
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeDisabled();
    expect(screen.getByTestId('opening-total')).toHaveTextContent('1,200.00');
  });

  it('disables Post while the preview is refetching or placeholder', () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    previewState = { isPlaceholderData: true, isFetching: true };
    render(<OpeningGratuityView />);
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeDisabled();
  });

  it('enables Post with payroll:approve', () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<OpeningGratuityView />);
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeEnabled();
  });
});

describe('defaultNextPeriod', () => {
  it('is the month after the latest live run, skipping voided ones', () => {
    expect(
      defaultNextPeriod(
        [
          { period: '2026-10', status: 'PAID' },
          { period: '2026-12', status: 'VOIDED' },
        ],
        null,
      ),
    ).toBe('2026-11');
  });
  it('starts after the cut-over month and rolls the year', () => {
    expect(defaultNextPeriod([], '2026-12-31')).toBe('2027-01');
  });
});
