import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { EmployeeLeaveDto } from '@saas/shared';
import { EmployeeLeaveTab } from './employee-leave-tab';
import { LeaveRecordModal } from './leave-record-modal';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));

vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

let leave: EmployeeLeaveDto;
const deleteRecord = vi.fn();
vi.mock('@/hooks/use-payroll', () => ({
  useEmployeeLeave: () => ({ data: leave, isPending: false, isError: false, error: null }),
  useCreateLeaveRecord: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLeaveRecord: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLeaveRecord: () => ({ mutateAsync: deleteRecord, isPending: false }),
  useAdjustLeave: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/platform/attachments-panel', () => ({
  AttachmentsPanel: () => <div data-testid="attachments" />,
}));

beforeEach(() => {
  granted = new Set(['employee:read']);
  deleteRecord.mockReset();
  leave = {
    balanceDays: 12.5,
    accruedToDate: 20,
    annualDays: 30,
    provision: 1450,
    records: [{ id: 'r1', employeeId: 'e1', type: 'SICK', startDate: '2026-03-02', endDate: '2026-03-04', days: 3, note: 'Flu', createdAt: '' }],
    entries: [{ id: 'l1', kind: 'ACCRUAL', days: 2, amount: 100, asOf: '2026-03-01', note: null, createdAt: '' }],
  };
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('EmployeeLeaveTab', () => {
  it('shows the balance, provision and records', () => {
    render(<EmployeeLeaveTab employeeId="e1" />);
    expect(screen.getByTestId('leave-balance')).toHaveTextContent('12.5');
    expect(screen.getByTestId('leave-provision')).toHaveTextContent('AED 1,450.00');
    expect(screen.getByText('Sick')).toBeInTheDocument();
    expect(screen.getByText('Flu')).toBeInTheDocument();
  });

  it('hides Add, row actions and attachments without employee:manage', () => {
    render(<EmployeeLeaveTab employeeId="e1" />);
    expect(screen.queryByRole('button', { name: /add leave/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adjust days/i })).not.toBeInTheDocument();
  });

  it('offers Add, Edit, Delete and Files with employee:manage, and Adjust with payroll:approve', () => {
    granted.add('employee:manage');
    granted.add('payroll:approve');
    render(<EmployeeLeaveTab employeeId="e1" />);
    expect(screen.getByRole('button', { name: /add leave/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /adjust days/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    expect(screen.getByTestId('attachments')).toBeInTheDocument();
  });

  it('asks before deleting a leave record, naming it, and deletes only on confirm', async () => {
    granted.add('employee:manage');
    deleteRecord.mockResolvedValue(undefined);
    render(<EmployeeLeaveTab employeeId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteRecord).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: /delete sick leave/i });
    expect(dialog).toHaveTextContent('3 days');
    fireEvent.click(screen.getByRole('button', { name: 'Delete leave' }));
    await waitFor(() => expect(deleteRecord).toHaveBeenCalledWith({ id: 'e1', recordId: 'r1' }));
  });

  it('cancelling the delete leaves the record alone', () => {
    granted.add('employee:manage');
    render(<EmployeeLeaveTab employeeId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it('hides the provision when the DTO omits it', () => {
    const { provision: _omit, ...withoutProvision } = leave;
    leave = withoutProvision;
    render(<EmployeeLeaveTab employeeId="e1" />);
    expect(screen.queryByTestId('leave-provision')).not.toBeInTheDocument();
    expect(screen.queryByText('Leave provision')).not.toBeInTheDocument();
  });
});

describe('LeaveRecordModal', () => {
  it('extending the dates of an existing record extends the days', async () => {
    const onSubmit = vi.fn();
    const record = { id: 'r1', employeeId: 'e1', type: 'SICK' as const, startDate: '2026-03-02', endDate: '2026-03-04', days: 3, note: null, createdAt: '' };
    render(<LeaveRecordModal open onClose={() => {}} existing={record} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-06' } });
    fireEvent.submit(screen.getByTestId('leave-record-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ endDate: '2026-03-06', days: 5 });
  });

  it('changing a date of an explicit half-day record without touching days sends days from the new span', async () => {
    const onSubmit = vi.fn();
    const record = { id: 'r1', employeeId: 'e1', type: 'SICK' as const, startDate: '2026-03-02', endDate: '2026-03-04', days: 2.5, note: null, createdAt: '' };
    render(<LeaveRecordModal open onClose={() => {}} existing={record} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-05' } });
    expect((screen.getByLabelText('Days (optional)') as HTMLInputElement).value).toBe('');
    fireEvent.submit(screen.getByTestId('leave-record-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ endDate: '2026-03-05', days: 4 });
  });

  it('keeps an explicit half-day count when the dates are untouched', async () => {
    const onSubmit = vi.fn();
    const record = { id: 'r1', employeeId: 'e1', type: 'SICK' as const, startDate: '2026-03-02', endDate: '2026-03-04', days: 2.5, note: null, createdAt: '' };
    render(<LeaveRecordModal open onClose={() => {}} existing={record} onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByTestId('leave-record-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ days: 2.5 });
  });

  it('defaults days to the calendar span and sends days as a number', async () => {
    const onSubmit = vi.fn();
    render(<LeaveRecordModal open onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-02' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-04' } });
    fireEvent.submit(screen.getByTestId('leave-record-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: 'ANNUAL', days: 3, note: null });
  });

  it('shows the server reason inline and stays open', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Overlaps existing leave'));
    render(<LeaveRecordModal open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-02' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-02' } });
    fireEvent.submit(screen.getByTestId('leave-record-form'));
    await waitFor(() => expect(screen.getByTestId('leave-server-error')).toHaveTextContent('Overlaps existing leave'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
