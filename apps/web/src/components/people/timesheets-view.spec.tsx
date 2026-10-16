import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TimesheetEntryDto, TimesheetEmployeeDto, TimesheetOperationOptionDto } from '@saas/shared';
import { TimesheetsView } from './timesheets-view';
import { PeopleIndex } from './people-index';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/people/timesheets',
  useRouter: () => ({ push: vi.fn(), replace }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));

const employees: TimesheetEmployeeDto[] = [
  { id: 'e1', employeeNumber: 'EMP-1', name: 'Amina Khan', status: 'ACTIVE', joiningDate: '2024-01-01', leavingDate: null, userId: null },
  { id: 'e2', employeeNumber: 'EMP-2', name: 'Bilal Raza', status: 'ACTIVE', joiningDate: '2024-01-01', leavingDate: null, userId: null },
  { id: 'e3', employeeNumber: 'EMP-3', name: 'Late Joiner', status: 'ACTIVE', joiningDate: '2030-01-01', leavingDate: null, userId: null },
];
const operations: TimesheetOperationOptionDto[] = [
  { workOrderId: 'w1', woNumber: 'WO-001', workOrderStatus: 'IN_PROGRESS', description: 'Gate', operationId: 'o1', operationLabel: 'Welding', operationStatus: 'RUNNING' },
  { workOrderId: 'w1', woNumber: 'WO-001', workOrderStatus: 'IN_PROGRESS', description: 'Gate', operationId: 'o2', operationLabel: 'Painting', operationStatus: 'PENDING' },
];

function entry(over: Partial<TimesheetEntryDto>): TimesheetEntryDto {
  return {
    id: 't1', employeeId: 'e1', employeeName: 'Amina Khan', employeeNumber: 'EMP-1', workDate: '2026-10-12', hours: 8,
    workOrderId: 'w1', woNumber: 'WO-001', operationId: 'o1', operationLabel: 'Welding', indirectCategory: null,
    source: 'MANUAL', note: 'rush job', locked: false, absorbed: false, ...over,
  };
}

let weekEntries: TimesheetEntryDto[] = [];
let crewEntries: TimesheetEntryDto[] = [];
const bulk = vi.fn();
vi.mock('@/hooks/use-timesheets', () => ({
  useTimesheetEmployees: () => ({ data: employees, isPending: false }),
  useTimesheetOperations: () => ({ data: operations, isPending: false }),
  useTimesheets: () => ({ data: weekEntries, isPending: false, isError: false }),
  useCrewTimesheets: () => ({ data: crewEntries, isPending: false, isError: false }),
  useSaveTimesheets: () => ({ mutateAsync: (v: unknown) => bulk(v), isPending: false }),
}));

const MON = '2026-10-12';
const cell = (day = MON, key = 'op:o1') => screen.getByTestId(`cell-${key}-${day}`) as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T09:00:00Z')); // a Wednesday: the week starts on 12 Oct
  granted = new Set(['timesheet:read', 'timesheet:manage']);
  weekEntries = [entry({}), entry({ id: 't2', workDate: '2026-10-13', hours: 4, note: null })];
  crewEntries = [];
  bulk.mockReset();
  bulk.mockResolvedValue([]);
  toastError.mockReset();
  replace.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('TimesheetsView week grid', () => {
  it('renders the employee week with daily totals', () => {
    render(<TimesheetsView />);
    expect(screen.getByText('WO-001 · Welding')).toBeTruthy();
    expect(cell().value).toBe('8');
    expect(screen.getByTestId(`day-total-${MON}`).textContent).toBe('8');
    expect(screen.getByTestId('day-total-2026-10-13').textContent).toBe('4');
    expect(screen.getByTestId('day-total-2026-10-14').textContent).toBe('0');
  });

  it('sends one bulk request with the upsert, keeping the existing note', async () => {
    render(<TimesheetsView />);
    fireEvent.change(cell(), { target: { value: '6.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk).toHaveBeenCalledWith({
      upserts: [
        {
          id: 't1', employeeId: 'e1', workDate: MON, hours: 6.5, operationId: 'o1', indirectCategory: null, note: 'rush job',
        },
      ],
      deletes: [],
    });
  });

  it('turns a cleared cell into a delete, not a zero-hour save', async () => {
    render(<TimesheetsView />);
    fireEvent.change(cell('2026-10-13'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk).toHaveBeenCalledWith({ upserts: [], deletes: ['t2'] });
  });

  it('refuses zero hours rather than sending them', async () => {
    render(<TimesheetsView />);
    fireEvent.change(cell(), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(bulk).not.toHaveBeenCalled();
  });

  it('adds a new entry for a category row', async () => {
    render(<TimesheetsView />);
    fireEvent.change(screen.getByLabelText('Add row'), { target: { value: 'cat:CLEANING' } });
    fireEvent.change(cell('2026-10-15', 'cat:CLEANING'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk).toHaveBeenCalledWith({
      upserts: [
        { employeeId: 'e1', workDate: '2026-10-15', hours: 2, operationId: null, indirectCategory: 'CLEANING', note: null },
      ],
      deletes: [],
    });
  });

  it('keeps the edits when the save fails', async () => {
    bulk.mockRejectedValue(new Error('Payroll posted'));
    render(<TimesheetsView />);
    fireEvent.change(cell(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    expect(cell().value).toBe('5');
  });

  it('shows a total above 24 hours in red', () => {
    render(<TimesheetsView />);
    fireEvent.change(screen.getByLabelText('Add row'), { target: { value: 'cat:IDLE' } });
    fireEvent.change(cell(MON, 'cat:IDLE'), { target: { value: '20' } });
    expect(screen.getByTestId(`day-total-${MON}`).className).toContain('text-danger');
  });

  it('makes a locked cell read-only with a tooltip', () => {
    weekEntries = [entry({ locked: true })];
    render(<TimesheetsView />);
    expect(cell().readOnly).toBe(true);
    expect(cell().title).toBe('Payroll for this month is posted');
  });

  it('makes a cell backed by several entries read-only', () => {
    weekEntries = [entry({}), entry({ id: 't9', hours: 1 })];
    render(<TimesheetsView />);
    expect(cell().readOnly).toBe(true);
    expect(cell().value).toBe('9');
    expect(cell().title).toBe('Several entries — edit in Crew day');
  });

  it('badges clock entries', () => {
    weekEntries = [entry({ source: 'CLOCK' })];
    render(<TimesheetsView />);
    expect(screen.getByLabelText('Clocked in')).toBeTruthy();
  });

  it('has no Save and read-only cells without timesheet:manage', () => {
    granted = new Set(['timesheet:read']);
    render(<TimesheetsView />);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(cell().readOnly).toBe(true);
  });
});

describe('TimesheetsView crew day', () => {
  function openCrew() {
    render(<TimesheetsView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Crew day' }));
    fireEvent.change(screen.getByLabelText('Work order'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'o1' } });
  }

  it('saves hours for two employees and lists only those employed that day', async () => {
    openCrew();
    expect(screen.queryByText('Late Joiner')).toBeNull();
    fireEvent.change(screen.getByLabelText('Hours for Amina Khan'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Hours for Bilal Raza'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    const payload = bulk.mock.calls[0][0] as { upserts: Record<string, unknown>[]; deletes: string[] };
    expect(payload.deletes).toEqual([]);
    expect(payload.upserts).toEqual([
      { employeeId: 'e1', workDate: '2026-10-14', hours: 8, operationId: 'o1', indirectCategory: null, note: null },
      { employeeId: 'e2', workDate: '2026-10-14', hours: 7.5, operationId: 'o1', indirectCategory: null, note: null },
    ]);
  });

  it('prefills existing hours and deletes when one is cleared', async () => {
    crewEntries = [entry({ workDate: '2026-10-14', hours: 3 })];
    openCrew();
    const input = screen.getByLabelText('Hours for Amina Khan') as HTMLInputElement;
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk).toHaveBeenCalledWith({ upserts: [], deletes: ['t1'] });
  });

  it('locks hours in a posted month', () => {
    crewEntries = [entry({ workDate: '2026-10-14', locked: true })];
    openCrew();
    const input = screen.getByLabelText('Hours for Amina Khan') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(within(input.closest('td') as HTMLElement).getByLabelText('Locked')).toBeTruthy();
  });
});

describe('PeopleIndex', () => {
  it('redirects to the first People page the session can see', () => {
    granted = new Set(['timesheet:read']);
    render(<PeopleIndex />);
    expect(replace).toHaveBeenCalledWith('/people/timesheets');
  });

  it('shows an empty state when nothing is visible', () => {
    granted = new Set();
    render(<PeopleIndex />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("You don't have access to People")).toBeTruthy();
  });
});
