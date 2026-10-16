import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PayrollRunDto, PayrollRunLineDto, PayslipDto } from '@saas/shared';
import { PayrollRunDetail } from './payroll-run-detail';
import { Payslip } from './payslip-view';
import { OpeningGratuityView } from './opening-gratuity-view';
import { PayrollRunsView } from './payroll-runs-view';
import { PensionPanel } from './pension-panel';
import { OpeningLeaveView } from './opening-leave-view';
import { defaultNextPeriod } from './payroll-format';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/people/payroll', useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-finance', () => ({ useFinanceAccounts: () => ({ data: [] }) }));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

const line: PayrollRunLineDto = {
  id: 'l1', employeeId: 'e1', employeeName: 'Amina Khan', employeeNumber: 'EMP-0001', paymentMethod: 'BANK',
  isNational: false, basic: 5000, housing: 2000, transport: 500, otherAllowances: [], gross: 7500,
  daysEmployed: 31, daysInMonth: 31, proratedGross: 7500, overtimeHours: 0, overtimeHoursPremium: 0,
  overtimeAmount: 0, bonusAmount: 0, bonusLabel: null, unpaidLeaveDays: 0, unpaidLeaveAmount: 0,
  advanceRecovery: 0, otherDeductionAmount: 0, otherDeductionLabel: null, salaryCost: 7500, netPay: 7500,
  gratuityBefore: 0, gratuityAccrual: 100, gratuityAfter: 100, flags: [], paidAt: null,
  halfPayDays: 0, halfPayAmount: 0, annualLeaveDays: 0, leaveDaysInPeriod: 0, leaveOverridden: false,
  pensionSchemeName: null, pensionBase: 0, pensionEmployee: 0, pensionEmployer: 0,
  leaveProvisionBefore: null, leaveProvisionChange: null, leaveProvisionAfter: null,
  standardHours: 0, loggedHours: 0, directHours: 0, labourRate: 0, labourAbsorbed: 0,
};

function makeRun(over: Partial<PayrollRunDto> = {}): PayrollRunDto {
  return {
    id: 'r1', runNumber: 'PAY-0001', period: '2026-11', payDate: '2026-11-30', status: 'DRAFT',
    totals: { salaryCost: 7500, overtime: 0, bonus: 0, unpaidLeave: 0, advanceRecovery: 0, otherDeductions: 0, net: 7500, gratuityAccrual: 100, halfPay: 0, pensionEmployee: 0, pensionEmployer: 0, leaveProvision: 0, bankNet: 7500, cashNet: 0, labourAbsorbed: 0 },
    bankPaidAt: null, cashPaidAt: null, approvedAt: null, approvedById: null, journalEntryId: null,
    lines: [line], createdAt: '', updatedAt: '', ...over,
  };
}

let run = makeRun();
let saving = false;
let previewState = { isPlaceholderData: false, isFetching: false };
let runsList: PayrollRunDto[] = [];
let leaveCutover: string | null = null;
let wpsEnabled = true;
let pensionPeriod: unknown = null;
const runSif = vi.fn();
const updateLine = vi.fn();
const deleteRun = vi.fn();
vi.mock('@/hooks/use-payroll', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useDeletePayrollRun: () => ({ mutateAsync: (id: string) => deleteRun(id), isPending: false }),
    useCreatePayrollRun: mutation,
    usePayrollRun: () => ({ data: run, isPending: false, isError: false, error: null }),
    useRefreshPayrollRun: mutation,
    useApprovePayrollRun: mutation,
    useVoidPayrollRun: mutation,
    usePayPayrollRun: mutation,
    useUpdatePayrollLine: () => ({ mutateAsync: (v: unknown) => updateLine(v) }),
    usePayrollLinesSaving: () => saving,
    usePayrollRuns: () => ({ data: { runs: runsList, openingGratuityCutover: null, openingLeaveCutover: leaveCutover }, isPending: false, isError: false }),
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
    usePayrollSettings: () => ({ data: { wpsEnabled } }),
    useRunSif: () => ({ mutateAsync: (id: string) => runSif(id), isPending: false }),
    usePensionPeriod: () => ({ data: pensionPeriod }),
    useRemitPension: mutation,
    useVoidPension: mutation,
    useOpeningLeavePreview: () => ({
      data: {
        cutoverDate: '2026-09-30',
        lines: [{ employeeId: 'e1', employeeName: 'Amina Khan', joiningDate: '2024-01-01', basic: 5000, serviceDays: 100, calculatedDays: 8 }],
      },
      isPending: false,
      isError: false,
      ...previewState,
    }),
    usePostOpeningLeave: mutation,
  };
});

beforeEach(() => {
  granted = new Set(['payroll:read']);
  run = makeRun();
  saving = false;
  previewState = { isPlaceholderData: false, isFetching: false };
  runsList = [];
  leaveCutover = null;
  wpsEnabled = true;
  pensionPeriod = null;
  runSif.mockReset();
  updateLine.mockReset();
  deleteRun.mockReset();
  push.mockReset();
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

  it('shows labour hours and absorption on an approved run, dashes on a draft, no labour total on draft or voided', () => {
    granted = new Set(['payroll:read']);
    const labourLine = { ...line, standardHours: 208, loggedHours: 150.5, directHours: 120, labourAbsorbed: 4321.5 };
    const totals = { ...makeRun().totals, labourAbsorbed: 4321.5 };
    run = makeRun({ lines: [labourLine], totals });
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    expect(screen.getByTestId('labour-absorbed')).toHaveTextContent('—');
    // No labour charged to jobs stat until the run is posted.
    expect(screen.queryByTestId('total-labour-absorbed')).not.toBeInTheDocument();
    unmount();

    run = makeRun({ status: 'APPROVED', lines: [labourLine], totals });
    const { unmount: unmount2 } = render(<PayrollRunDetail id="r1" />);
    expect(screen.getByRole('columnheader', { name: 'Standard h' })).toBeInTheDocument();
    expect(screen.getByTestId('labour-hours-0')).toHaveTextContent('208');
    expect(screen.getByTestId('labour-hours-1')).toHaveTextContent('150.5');
    expect(screen.getByTestId('labour-hours-2')).toHaveTextContent('120');
    expect(screen.getByTestId('labour-absorbed')).toHaveTextContent('4,321.50');
    expect(screen.getByTestId('total-labour-absorbed')).toHaveTextContent('4,321.50');
    unmount2();

    run = makeRun({ status: 'VOIDED', lines: [labourLine], totals });
    render(<PayrollRunDetail id="r1" />);
    expect(screen.queryByTestId('total-labour-absorbed')).not.toBeInTheDocument();
  });

  it('disables the Approve and Pay confirmations while a line update is saving', async () => {
    granted = new Set(['payroll:read', 'payroll:approve', 'payroll:pay']);
    saving = true;
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    await act(async () => { fireEvent.click(btn(/^approve$/i)!); });
    expect(screen.getByRole('button', { name: /approve run/i, hidden: true })).toBeDisabled();
    unmount();
    run = makeRun({ status: 'APPROVED' });
    render(<PayrollRunDetail id="r1" />);
    await act(async () => { fireEvent.click(btn(/pay bank/i)!); });
    expect(screen.getByRole('button', { name: /record payment/i, hidden: true })).toBeDisabled();
    expect(screen.getByTestId('pay-blocked')).toHaveTextContent(/saving line changes/i);
  });

  it('Approve flushes a just-typed line edit and keeps confirm disabled until it is saved', async () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    let resolve!: (v: unknown) => void;
    updateLine.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<PayrollRunDetail id="r1" />);
    fireEvent.change(screen.getByLabelText('Bonus for Amina Khan'), { target: { value: '250' } });
    // No wait for the debounce: Approve sends the pending edit at once.
    await act(async () => { fireEvent.click(btn(/^approve$/i)!); });
    expect(updateLine).toHaveBeenCalledTimes(1);
    expect(updateLine.mock.calls[0][0]).toMatchObject({ lineId: 'l1', input: { bonusAmount: 250 } });
    const confirm = screen.getByRole('button', { name: /approve run/i, hidden: true });
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('confirm-blocked')).toHaveTextContent(/saving line changes/i);

    await act(async () => { resolve({}); });
    expect(confirm).toBeEnabled();
    expect(screen.queryByTestId('confirm-blocked')).toBeNull();
  });

  it('keeps Approve confirm disabled while a line edit was refused', async () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    updateLine.mockRejectedValueOnce(new Error('Only 0.00 of the advance is outstanding'));
    render(<PayrollRunDetail id="r1" />);
    fireEvent.change(screen.getByLabelText('Advance recovery for Amina Khan'), { target: { value: '500' } });
    await act(async () => { fireEvent.click(btn(/^approve$/i)!); });
    const confirm = screen.getByRole('button', { name: /approve run/i, hidden: true });
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('confirm-blocked')).toHaveTextContent(/refused/i);
  });

  it('offers Delete draft only on a draft with payroll:manage, and goes back to the list', async () => {
    granted = new Set(['payroll:read', 'payroll:approve']);
    const { unmount } = render(<PayrollRunDetail id="r1" />);
    expect(btn(/delete draft/i)).toBeNull();
    unmount();

    granted = new Set(['payroll:read', 'payroll:manage']);
    run = makeRun({ status: 'APPROVED' });
    const second = render(<PayrollRunDetail id="r1" />);
    expect(btn(/delete draft/i)).toBeNull();
    second.unmount();

    run = makeRun();
    deleteRun.mockResolvedValueOnce(undefined);
    render(<PayrollRunDetail id="r1" />);
    fireEvent.click(screen.getByRole('button', { name: /delete draft/i }));
    const buttons = screen.getAllByRole('button', { name: /delete draft/i, hidden: true });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(deleteRun).toHaveBeenCalledWith('r1');
    expect(push).toHaveBeenCalledWith('/people/payroll');
  });

  it('links each line to its payslip', () => {
    render(<PayrollRunDetail id="r1" />);
    expect(screen.getByRole('link', { name: /payslip for amina khan/i })).toHaveAttribute(
      'href',
      '/people/payroll/r1/payslips/l1',
    );
  });
});

describe('PayrollRunDetail SIF and pension', () => {
  it('shows Export SIF on a posted run only with payroll:pay, disabled with a reason while WPS is off', () => {
    run = makeRun({ status: 'APPROVED' });
    granted = new Set(['payroll:read', 'payroll:approve']);
    const first = render(<PayrollRunDetail id="r1" />);
    expect(btn(/export sif/i)).toBeNull();
    first.unmount();

    granted = new Set(['payroll:read', 'payroll:pay']);
    const second = render(<PayrollRunDetail id="r1" />);
    expect(btn(/export sif/i)).toBeEnabled();
    second.unmount();

    wpsEnabled = false;
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/export sif/i)).toBeDisabled();
    expect(screen.getByTestId('sif-disabled-reason')).toHaveTextContent('Switch on WPS in payroll settings');
  });

  it('does not offer Export SIF on a draft', () => {
    granted = new Set(['payroll:read', 'payroll:pay']);
    render(<PayrollRunDetail id="r1" />);
    expect(btn(/export sif/i)).toBeNull();
  });

  it('shows the pension panel on a posted run with pension, not on a draft', () => {
    granted = new Set(['payroll:read']);
    pensionPeriod = { period: '2026-11', employeeTotal: 100, employerTotal: 200, due: 300, lines: [], remittance: null };
    const totals = { ...makeRun().totals, pensionEmployee: 100, pensionEmployer: 200 };
    run = makeRun({ status: 'APPROVED', totals });
    const first = render(<PayrollRunDetail id="r1" />);
    expect(screen.getByTestId('pension-due')).toHaveTextContent('300.00');
    first.unmount();
    run = makeRun({ totals });
    render(<PayrollRunDetail id="r1" />);
    expect(screen.queryByTestId('pension-due')).toBeNull();
  });
});

describe('PensionPanel', () => {
  const remittance = { id: 'p1', period: '2026-11', amount: 300, financeAccountId: 'a1', paidAt: '2026-12-05', voidedAt: null, createdAt: '' };
  beforeEach(() => {
    pensionPeriod = { period: '2026-11', employeeTotal: 100, employerTotal: 200, due: 300, lines: [], remittance: null };
  });

  it('hides Remit without payroll:pay and offers it with', () => {
    granted = new Set(['payroll:read']);
    const first = render(<PensionPanel period="2026-11" />);
    expect(btn(/^remit$/i)).toBeNull();
    first.unmount();
    granted = new Set(['payroll:read', 'payroll:pay']);
    render(<PensionPanel period="2026-11" />);
    expect(btn(/^remit$/i)).not.toBeNull();
  });

  it('shows Remitted and Void when a remittance exists', () => {
    granted = new Set(['payroll:read', 'payroll:pay']);
    pensionPeriod = { ...(pensionPeriod as object), remittance };
    render(<PensionPanel period="2026-11" />);
    expect(screen.getByText('Remitted')).toBeInTheDocument();
    expect(btn(/^remit$/i)).toBeNull();
    expect(btn(/void remittance/i)).not.toBeNull();
  });
});

describe('OpeningLeaveView', () => {
  it('disables Post without payroll:approve and enables it with', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    const first = render(<OpeningLeaveView />);
    expect(screen.getByRole('button', { name: /post opening leave balances/i })).toBeDisabled();
    expect(screen.getByTestId('opening-leave-total')).toHaveTextContent('8');
    first.unmount();
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<OpeningLeaveView />);
    expect(screen.getByRole('button', { name: /post opening leave balances/i })).toBeEnabled();
  });

  it('allows a negative balance but rejects a cleared one', () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<OpeningLeaveView />);
    const input = screen.getByLabelText('Opening leave days for Amina Khan');
    fireEvent.change(input, { target: { value: '-3' } });
    expect(screen.getByRole('button', { name: /post opening leave balances/i })).toBeEnabled();
    expect(screen.getByTestId('opening-leave-total')).toHaveTextContent('-3');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /post opening leave balances/i })).toBeDisabled();
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

  it('a cleared or negative override marks the row invalid and disables Post', () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<OpeningGratuityView />);
    const input = screen.getByLabelText('Opening balance for Amina Khan');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter an amount/i);
    fireEvent.change(input, { target: { value: '-5' } });
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: '1500' } });
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeEnabled();
    expect(screen.getByTestId('opening-total')).toHaveTextContent('1,500.00');
  });

  it('enables Post with payroll:approve', () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<OpeningGratuityView />);
    expect(screen.getByRole('button', { name: /post opening balances/i })).toBeEnabled();
  });
});

describe('PayrollRunsView opening prompt', () => {
  it('prompts for opening balances before go-live, and not once a run is posted', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    runsList = [makeRun({ status: 'DRAFT' })];
    const { unmount } = render(<PayrollRunsView />);
    expect(screen.getByTestId('opening-gratuity-prompt')).toBeInTheDocument();
    unmount();
    for (const status of ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const) {
      runsList = [makeRun({ status })];
      const view = render(<PayrollRunsView />);
      expect(screen.queryByTestId('opening-gratuity-prompt')).toBeNull();
      view.unmount();
    }
  });
});

describe('PayrollRunsView opening leave link', () => {
  it('links to opening leave while no cut-over is posted, even with posted runs', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    runsList = [makeRun({ status: 'PAID' })];
    const first = render(<PayrollRunsView />);
    expect(screen.getByRole('link', { name: /set up opening leave balances/i })).toHaveAttribute('href', '/people/payroll/opening-leave');
    first.unmount();
    leaveCutover = '2026-09-30';
    render(<PayrollRunsView />);
    expect(screen.queryByTestId('opening-leave-prompt')).toBeNull();
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
