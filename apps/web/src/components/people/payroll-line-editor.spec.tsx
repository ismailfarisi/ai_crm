import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PayrollRunLineDto } from '@saas/shared';
import { PayrollLineEditor, EDIT_DEBOUNCE_MS } from './payroll-line-editor';

const mutateAsync = vi.fn();
vi.mock('@/hooks/use-payroll', () => ({ useUpdatePayrollLine: () => ({ mutateAsync }) }));

const line = {
  id: 'l1', employeeId: 'e1', employeeName: 'Amina Khan', employeeNumber: 'EMP-0001', paymentMethod: 'BANK',
  isNational: false, basic: 5000, housing: 0, transport: 0, otherAllowances: [], gross: 5000,
  daysEmployed: 30, daysInMonth: 30, proratedGross: 5000, overtimeHours: 0, overtimeHoursPremium: 0,
  overtimeAmount: 0, bonusAmount: 0, bonusLabel: null, unpaidLeaveDays: 0, unpaidLeaveAmount: 0,
  advanceRecovery: 0, otherDeductionAmount: 0, otherDeductionLabel: null, salaryCost: 5000, netPay: 5000,
  gratuityBefore: 0, gratuityAccrual: 0, gratuityAfter: 0, flags: [], paidAt: null,
} as PayrollRunLineDto;

beforeEach(() => {
  vi.useFakeTimers();
  mutateAsync.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('PayrollLineEditor', () => {
  it('keeps a rejected edit visible when a later edit succeeds, and sends one PATCH at a time', async () => {
    let rejectFirst!: (e: Error) => void;
    mutateAsync
      .mockImplementationOnce(() => new Promise((_, rej) => { rejectFirst = rej; }))
      .mockResolvedValueOnce({});
    render(
      <table>
        <tbody>
          <PayrollLineEditor runId="r1" line={line} editable />
        </tbody>
      </table>,
    );
    fireEvent.change(screen.getByLabelText('Bonus for Amina Khan'), { target: { value: '9999999' } });
    await act(async () => { vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10); });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Unpaid leave days for Amina Khan'), { target: { value: '2' } });
    await act(async () => { vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10); });
    // The first PATCH is still in flight, so the second waits.
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => { rejectFirst(new Error('Bonus too large')); });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1][0].input).toEqual({ unpaidLeaveDays: 2 });
    expect(screen.getByRole('alert')).toHaveTextContent('Bonus too large');
  });

  it('a cleared amount is saved as 0 and a cleared label as null', async () => {
    mutateAsync.mockResolvedValue({});
    render(
      <table>
        <tbody>
          <PayrollLineEditor runId="r1" line={{ ...line, bonusAmount: 300, bonusLabel: 'Q3' }} editable />
        </tbody>
      </table>,
    );
    fireEvent.change(screen.getByLabelText('Bonus for Amina Khan'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Bonus label for Amina Khan'), { target: { value: '' } });
    await act(async () => { vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10); });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0].input).toEqual({ bonusAmount: 0, bonusLabel: null });
    expect(screen.getByLabelText('Bonus for Amina Khan')).toHaveValue(null);
  });
});
