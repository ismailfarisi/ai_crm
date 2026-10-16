import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PrepaidScheduleDto } from '@saas/shared';
import { PrepaidSchedulesPanel, roleLabel } from './prepaid-schedules-panel';

let canManage = true;
const mutateAsync = vi.fn().mockResolvedValue({});
let schedules: PrepaidScheduleDto[] = [];

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => canManage }),
  useCan: () => canManage,
}));
vi.mock('@/hooks/use-finance', () => ({
  usePrepaidSchedules: () => ({ data: schedules }),
  useEndPrepaidEarly: () => ({ mutateAsync, isPending: false }),
}));

const schedule: PrepaidScheduleDto = {
  id: 's1',
  billId: 'b1',
  billLineId: 'l1',
  expenseRole: 'RENT',
  totalBase: 1200,
  firstMonth: '2026-01-01',
  months: 12,
  releasedMonths: 3,
  releasedAmount: 300,
  remainingAmount: 900,
  status: 'ACTIVE',
};
const lines = [
  { id: 'l1', purchaseOrderLineId: null, description: 'Annual lease', qty: 1, unitCost: 1200, orderUnitCost: null, lineTotal: 1200 },
];

describe('PrepaidSchedulesPanel', () => {
  beforeEach(() => {
    canManage = true;
    schedules = [schedule];
    mutateAsync.mockClear();
  });

  it('shows progress and amounts per schedule', () => {
    render(<PrepaidSchedulesPanel billId="b1" lines={lines} />);
    expect(screen.getByText('Annual lease')).toBeTruthy();
    expect(screen.getByText(/Released 3 of 12 months/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText(/Remaining 900\.00/)).toBeTruthy();
  });

  it('confirms before ending early', () => {
    render(<PrepaidSchedulesPanel billId="b1" lines={lines} />);
    fireEvent.click(screen.getByRole('button', { name: 'End early' }));
    expect(screen.getByText('Post the remaining 900.00 to Rent today?')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'End early' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(mutateAsync).toHaveBeenCalledWith('s1');
  });

  it('hides End early without finance:manage', () => {
    canManage = false;
    render(<PrepaidSchedulesPanel billId="b1" lines={lines} />);
    expect(screen.queryByRole('button', { name: 'End early' })).toBeNull();
  });

  it('renders nothing when there are no schedules', () => {
    schedules = [];
    const { container } = render(<PrepaidSchedulesPanel billId="b1" lines={lines} />);
    expect(container.firstChild).toBeNull();
  });

  it('humanises a ledger role', () => {
    expect(roleLabel('SOFTWARE_IT')).toBe('Software it');
  });
});
