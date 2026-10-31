import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
const saveSettings = vi.fn();
const updateScheme = vi.fn();
const deleteScheme = vi.fn();
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

vi.mock('@/hooks/use-payroll', () => ({
  usePayrollSettings: () => ({ data: settings, isPending: false, isError: false, error: null }),
  useSavePayrollSettings: () => ({ mutateAsync: saveSettings, isPending: false }),
  usePensionSchemes: () => ({ data: schemes, isPending: false, isError: false, error: null }),
  useCreatePensionScheme: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePensionScheme: () => ({ mutate: vi.fn(), mutateAsync: updateScheme, isPending: false }),
  useDeletePensionScheme: () => ({ mutate: vi.fn(), mutateAsync: deleteScheme, isPending: false }),
}));

beforeEach(() => {
  granted = new Set(['payroll:read']);
  saveSettings.mockReset();
  updateScheme.mockReset().mockResolvedValue(undefined);
  deleteScheme.mockReset().mockResolvedValue(undefined);
  settings = { wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 30, monthlyStandardHours: 208 };
  schemes = [scheme({}), scheme({ id: 's2', name: 'Assigned fund', assignedCount: 3, isActive: true })];
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('PayrollSettingsView', () => {
  it('asks before activating a scheme and says what it deducts', async () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(updateScheme).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Activate GPSSA?' });
    expect(dialog).toHaveTextContent(/deducts 5% from the pay/);
    fireEvent.click(screen.getByRole('button', { name: 'Activate scheme' }));
    await waitFor(() => expect(updateScheme).toHaveBeenCalledWith({ id: 's1', input: { isActive: true } }));
  });

  it('asks before deactivating, naming the employees it stops deducting for', async () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getByRole('dialog', { name: 'Deactivate Assigned fund?' })).toHaveTextContent('3 employees');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateScheme).not.toHaveBeenCalled();
  });

  it('asks before deleting a scheme', async () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    const row = screen.getByTestId('scheme-s1');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(deleteScheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete scheme' }));
    await waitFor(() => expect(deleteScheme).toHaveBeenCalledWith('s1'));
  });

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

  it('shows the monthly standard hours and submits an edited value', async () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    const input = screen.getByLabelText('Monthly standard hours') as HTMLInputElement;
    expect(input.value).toBe('208');
    expect(screen.getByText(/26 days × 8 hours = 208/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.submit(screen.getByTestId('payroll-settings-form'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings.mock.calls[0][0]).toMatchObject({ monthlyStandardHours: 200 });
  });

  it('treats a cleared standard hours field as a validation error, not a reset to 0 or 208', async () => {
    granted.add('payroll:manage');
    render(<PayrollSettingsView />);
    fireEvent.change(screen.getByLabelText('Monthly standard hours'), { target: { value: '' } });
    fireEvent.submit(screen.getByTestId('payroll-settings-form'));
    expect(await screen.findByText(/greater than or equal to 100|Too small/i)).toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('keeps valid stored WPS values when saving with WPS off', async () => {
    granted.add('payroll:manage');
    settings = { ...settings, wpsEnabled: false, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '123456789' };
    render(<PayrollSettingsView />);
    fireEvent.submit(screen.getByTestId('payroll-settings-form'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings.mock.calls[0][0]).toMatchObject({
      wpsEnabled: false, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '123456789',
    });
  });

  it('saves with WPS off when a stale hidden value is invalid, sending only that field as null', async () => {
    granted.add('payroll:manage');
    settings = { ...settings, wpsEnabled: false, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '12' };
    render(<PayrollSettingsView />);
    fireEvent.submit(screen.getByTestId('payroll-settings-form'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings.mock.calls[0][0]).toMatchObject({
      wpsEnabled: false, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: null,
    });
  });
});
