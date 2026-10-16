import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PayrollSettingsDto, PensionSchemeDto } from '@saas/shared';
import { PayrollSettingsView } from './payroll-settings-view';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/people/settings' }));

let settings: PayrollSettingsDto;
const scheme = (over: Partial<PensionSchemeDto>): PensionSchemeDto => ({
  id: 's1', name: 'GPSSA', presetKey: null, employeePct: 5, employerPct: 12.5, base: 'BASIC_HOUSING',
  minSalary: null, maxSalary: null, isActive: false, assignedCount: 0, createdAt: '', ...over,
});
let schemes: PensionSchemeDto[];

vi.mock('@/hooks/use-payroll', () => ({
  usePayrollSettings: () => ({ data: settings, isPending: false, isError: false, error: null }),
  useSavePayrollSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePensionSchemes: () => ({ data: schemes, isPending: false, isError: false, error: null }),
  useCreatePensionScheme: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePensionScheme: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeletePensionScheme: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  granted = new Set(['payroll:read']);
  settings = { wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 30 };
  schemes = [scheme({}), scheme({ id: 's2', name: 'Assigned fund', assignedCount: 3, isActive: true })];
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('PayrollSettingsView', () => {
  it('hides the WPS fields while WPS is off and shows them when it is ticked', () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    expect(screen.queryByTestId('wps-fields')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Generate a WPS salary file/));
    expect(screen.getByTestId('wps-fields')).toBeInTheDocument();
    expect(screen.getByText(/13-digit establishment ID/)).toBeInTheDocument();
  });

  it('is read-only without payroll:manage', () => {
    settings = { ...settings, wpsEnabled: true, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '123456789' };
    render(<PayrollSettingsView />);
    expect(screen.getByLabelText('Employer ID')).toBeDisabled();
    expect(screen.getByLabelText('Annual leave days')).toBeDisabled();
    expect(screen.queryByTestId('btn-save-settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
  });

  it('disables Delete for an assigned scheme and explains why', () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    const assigned = screen.getByTestId('scheme-s2');
    const del = assigned.querySelector('button[disabled]') as HTMLButtonElement;
    expect(del).toHaveTextContent('Delete');
    expect(del.title).toMatch(/Assigned to employees/);
    const free = screen.getByTestId('scheme-s1');
    expect(free.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect(screen.getByText(/Presets start inactive/)).toBeInTheDocument();
  });
});
