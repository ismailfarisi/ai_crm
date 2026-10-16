import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { EmployeeDto, SettlementDto, SettlementStatementDto } from '@saas/shared';
import { SettlementsView } from './settlements-view';
import { SettlementDetail } from './settlement-detail';
import { SettlementStatement } from './settlement-statement';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/people/settlements', useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-finance', () => ({ useFinanceAccounts: () => ({ data: [] }) }));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

function makeSettlement(over: Partial<SettlementDto> = {}): SettlementDto {
  return {
    id: 's1', settlementNumber: 'FS-0001', employeeId: 'e1', employeeName: 'Amina Khan', leavingDate: '2026-10-31',
    reason: 'RESIGNATION', serviceDays: 800, basic: 5000, gross: 7500, leaveBalanceDays: 10, status: 'DRAFT',
    netPay: 9000, paymentMethod: 'BANK', financeAccountId: null, paidAt: null, approvedAt: null, journalEntryId: null,
    lines: [
      { id: 'l1', kind: 'GRATUITY', label: 'End-of-service gratuity (2.19 years)', quantity: null, rate: null, amount: 8000 },
      { id: 'l2', kind: 'LEAVE_ENCASHMENT', label: 'Untaken leave encashment', quantity: 10, rate: 166.6667, amount: 1666.67 },
      { id: 'l3', kind: 'ADVANCE_RECOVERY', label: 'Salary advance recovered', quantity: null, rate: null, amount: -500 },
    ],
    createdAt: '', updatedAt: '2026-11-01T00:00:00Z', ...over,
  };
}

const leaver = (id: string, name: string): EmployeeDto =>
  ({ id, employeeNumber: `EMP-${id}`, fullName: name, status: 'LEFT' }) as EmployeeDto;

let settlement = makeSettlement();
let list: SettlementDto[] = [];
let leavers: EmployeeDto[] = [];
let wpsEnabled = true;
const approve = vi.fn();
const refresh = vi.fn();
const sif = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock('@/hooks/use-payroll', () => ({
  useSettlements: () => ({ data: list, isPending: false, isError: false, error: null }),
  useSettlement: () => ({ data: settlement, isPending: false, isError: false, error: null, isFetching: false }),
  useEmployees: () => ({ data: leavers }),
  useCreateSettlement: () => ({ mutateAsync: (v: unknown) => create(v), isPending: false }),
  useUpdateSettlement: () => ({ mutateAsync: (v: unknown) => update(v), isPending: false }),
  useRefreshSettlement: () => ({ mutate: (id: string) => refresh(id), isPending: false }),
  useDeleteSettlement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveSettlement: () => ({ mutateAsync: (id: string) => approve(id), isPending: false }),
  useVoidSettlement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePaySettlement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSettlementSif: () => ({ mutateAsync: (id: string) => sif(id), isPending: false }),
  usePayrollSettings: () => ({ data: { wpsEnabled } }),
}));

beforeEach(() => {
  granted = new Set(['payroll:read']);
  settlement = makeSettlement();
  list = [];
  leavers = [];
  wpsEnabled = true;
  approve.mockReset();
  refresh.mockReset();
  sif.mockReset();
  create.mockReset();
  update.mockReset();
  push.mockReset();
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const btn = (name: RegExp) => screen.queryByRole('button', { name });

describe('SettlementsView', () => {
  it('renders a row per settlement and hides New without payroll:manage', () => {
    list = [makeSettlement(), makeSettlement({ id: 's2', settlementNumber: 'FS-0002', employeeName: 'Omar Ali', status: 'PAID' })];
    const first = render(<SettlementsView />);
    expect(screen.getByRole('link', { name: 'FS-0001' })).toHaveAttribute('href', '/people/settlements/s1');
    expect(screen.getByText('Omar Ali')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(btn(/new settlement/i)).toBeNull();
    first.unmount();
    granted = new Set(['payroll:read', 'payroll:manage']);
    render(<SettlementsView />);
    expect(btn(/new settlement/i)).not.toBeNull();
  });

  it('offers only leavers without a live settlement and shows a server refusal inline', async () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    list = [makeSettlement({ employeeId: 'e1' }), makeSettlement({ id: 's3', employeeId: 'e3', status: 'VOIDED' })];
    leavers = [leaver('e1', 'Amina Khan'), leaver('e2', 'Omar Ali'), leaver('e3', 'Sara Noor')];
    create.mockRejectedValueOnce(new Error('Post the October payroll run first'));
    render(<SettlementsView />);
    fireEvent.click(btn(/new settlement/i)!);
    const select = screen.getByLabelText('Employee') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Omar Ali (EMP-e2)');
    expect(labels).toContain('Sara Noor (EMP-e3)');
    expect(labels).not.toContain('Amina Khan (EMP-e1)');
    fireEvent.change(select, { target: { value: 'e2' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('new-settlement-form'));
    });
    expect(create).toHaveBeenCalledWith({ employeeId: 'e2', reason: 'RESIGNATION' });
    expect(screen.getByRole('alert')).toHaveTextContent('Post the October payroll run first');
  });
});

describe('SettlementDetail', () => {
  it('shows the header figures and the lines', () => {
    render(<SettlementDetail id="s1" />);
    expect(screen.getByTestId('settlement-service')).toHaveTextContent('2 years 70 days');
    expect(screen.getByTestId('settlement-net')).toHaveTextContent('9,000.00');
    expect(screen.getByText('Untaken leave encashment')).toBeInTheDocument();
  });

  it('edits only while a draft with payroll:manage', () => {
    const first = render(<SettlementDetail id="s1" />);
    expect(screen.queryByTestId('settlement-form')).toBeNull();
    first.unmount();

    granted = new Set(['payroll:read', 'payroll:manage']);
    const second = render(<SettlementDetail id="s1" />);
    expect(screen.getByTestId('settlement-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Leave encashment days')).toHaveValue(10);
    expect(screen.getByLabelText('Advance recovery')).toHaveValue(500);
    expect(btn(/^refresh$/i)).not.toBeNull();
    expect(screen.getByTestId('refresh-note')).toHaveTextContent(/resets leave encashment days and advance recovery/i);
    second.unmount();

    settlement = makeSettlement({ status: 'APPROVED' });
    render(<SettlementDetail id="s1" />);
    expect(screen.queryByTestId('settlement-form')).toBeNull();
    expect(btn(/^refresh$/i)).toBeNull();
    expect(btn(/delete draft/i)).toBeNull();
  });

  it('hides leave encashment when the balance is negative', () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    settlement = makeSettlement({ leaveBalanceDays: -2 });
    render(<SettlementDetail id="s1" />);
    expect(screen.queryByLabelText('Leave encashment days')).toBeNull();
  });

  it('shows Approve only on a draft with payroll:approve', () => {
    const first = render(<SettlementDetail id="s1" />);
    expect(btn(/^approve$/i)).toBeNull();
    first.unmount();
    granted = new Set(['payroll:read', 'payroll:approve']);
    const second = render(<SettlementDetail id="s1" />);
    expect(btn(/^approve$/i)).not.toBeNull();
    expect(btn(/^void$/i)).toBeNull();
    second.unmount();
    settlement = makeSettlement({ status: 'APPROVED' });
    render(<SettlementDetail id="s1" />);
    expect(btn(/^approve$/i)).toBeNull();
    expect(btn(/^void$/i)).not.toBeNull();
  });

  it('turns a stale-draft refusal into a Refresh action', async () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    approve.mockRejectedValueOnce(new Error('Balances changed since FS-0001 was drafted; refresh it'));
    render(<SettlementDetail id="s1" />);
    fireEvent.click(btn(/^approve$/i)!);
    const confirm = screen.getByRole('button', { name: /approve settlement/i, hidden: true });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(screen.getByTestId('approve-stale')).toHaveTextContent(/refresh it/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh now/i }));
    });
    expect(refresh).toHaveBeenCalledWith('s1');
  });

  it('offers Pay only for APPROVED with payroll:pay', () => {
    granted = new Set(['payroll:read', 'payroll:pay']);
    const first = render(<SettlementDetail id="s1" />);
    expect(btn(/^pay$/i)).toBeNull();
    first.unmount();
    settlement = makeSettlement({ status: 'APPROVED' });
    const second = render(<SettlementDetail id="s1" />);
    expect(btn(/^pay$/i)).not.toBeNull();
    second.unmount();
    settlement = makeSettlement({ status: 'PAID' });
    render(<SettlementDetail id="s1" />);
    expect(btn(/^pay$/i)).toBeNull();
  });

  it('shows Export SIF for posted bank settlements, disabled with a reason while WPS is off', () => {
    settlement = makeSettlement({ status: 'APPROVED' });
    granted = new Set(['payroll:read', 'payroll:approve']);
    const first = render(<SettlementDetail id="s1" />);
    expect(btn(/export sif/i)).toBeNull();
    first.unmount();

    granted = new Set(['payroll:read', 'payroll:pay']);
    const second = render(<SettlementDetail id="s1" />);
    expect(btn(/export sif/i)).toBeEnabled();
    second.unmount();

    settlement = makeSettlement({ status: 'APPROVED', paymentMethod: 'CASH' });
    const third = render(<SettlementDetail id="s1" />);
    expect(btn(/export sif/i)).toBeNull();
    third.unmount();

    settlement = makeSettlement({ status: 'APPROVED' });
    wpsEnabled = false;
    render(<SettlementDetail id="s1" />);
    expect(btn(/export sif/i)).toBeDisabled();
    expect(screen.getByTestId('sif-disabled-reason')).toHaveTextContent('Switch on WPS in payroll settings');
  });

  it('saves a cleared notice days and advance recovery as 0', async () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    update.mockResolvedValue({});
    render(<SettlementDetail id="s1" />);
    fireEvent.change(screen.getByLabelText('Notice days'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Advance recovery'), { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('settlement-form'));
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ id: 's1', input: { noticeDays: 0, advanceRecovery: 0 } });
  });

  it('refuses to save a cleared encashment field and says how to restore it', async () => {
    granted = new Set(['payroll:read', 'payroll:manage']);
    render(<SettlementDetail id="s1" />);
    fireEvent.change(screen.getByLabelText('Leave encashment days'), { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('settlement-form'));
    });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter the days, or use refresh/i);
  });

  it('blocks Approve while the form has unsaved changes', async () => {
    granted = new Set(['payroll:read', 'payroll:manage', 'payroll:approve']);
    render(<SettlementDetail id="s1" />);
    fireEvent.change(screen.getByLabelText('Notice days'), { target: { value: '3' } });
    await act(async () => {
      fireEvent.click(btn(/^approve$/i)!);
    });
    expect(screen.getByRole('button', { name: /approve settlement/i, hidden: true })).toBeDisabled();
    expect(screen.getByTestId('confirm-blocked')).toHaveTextContent(/unsaved changes/i);
  });

  it('links to the statement', () => {
    render(<SettlementDetail id="s1" />);
    expect(screen.getByRole('link', { name: /statement/i })).toHaveAttribute('href', '/people/settlements/s1/statement');
  });
});

describe('SettlementStatement', () => {
  const statement: SettlementStatementDto = {
    settlement: makeSettlement({ status: 'PAID', netPay: 9166.67 }),
    employee: {
      employeeNumber: 'EMP-0001', fullName: 'Amina Khan', jobTitle: 'Designer', joiningDate: '2024-08-01',
      ibanMasked: 'AE07 **** 3456', bankName: 'ENBD',
    },
    organization: { name: 'Acme', legalName: 'Acme LLC', address: null, baseCurrency: 'AED' },
  };

  it('shows the net and only the masked IBAN', () => {
    render(<SettlementStatement statement={statement} />);
    expect(screen.getByTestId('statement-net')).toHaveTextContent('AED 9,166.67');
    expect(screen.getByTestId('statement-iban')).toHaveTextContent('AE07 **** 3456');
    expect(screen.getByTestId('statement-service')).toHaveTextContent('2 years 70 days');
    expect(screen.getByText('Acme LLC')).toBeInTheDocument();
    expect(screen.getByText(/salary advance recovered/i)).toBeInTheDocument();
  });
});
