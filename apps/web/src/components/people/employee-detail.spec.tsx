import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EmployeeDto } from '@saas/shared';
import { EmployeeDetail } from './employee-detail';

let granted = new Set<string>();
let current: EmployeeDto;
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/people/employees/e1' }));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

const employee: EmployeeDto = {
  id: 'e1', employeeNumber: 'EMP-0001', firstName: 'Amina', lastName: 'Khan', fullName: 'Amina Khan',
  jobTitle: 'Designer', department: 'Studio', userId: null, joiningDate: '2024-01-01', leavingDate: null,
  status: 'ACTIVE', nationality: 'PK', isNational: false, paymentMethod: 'BANK', bankName: 'ENBD',
  iban: 'AE070331234567890123456', ibanMasked: 'AE07 **** 3456', email: null, phone: null,
  wpsPersonId: null, bankRoutingCode: null, pensionSchemeId: null, annualLeaveDaysOverride: null, probationEndDate: null,
  createdAt: '', updatedAt: '',
};

vi.mock('@/hooks/use-payroll', () => ({
  useEmployee: () => ({ data: current, isPending: false, isError: false, error: null }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalaryPackages: () => ({ data: [], isPending: false, isError: false }),
  usePensionSchemes: () => ({ data: [], isPending: false, isError: false }),
  useAddSalaryPackage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/platform/attachments-panel', () => ({
  AttachmentsPanel: () => <div data-testid="attachments" />,
}));
vi.mock('./employee-gratuity-tab', () => ({ EmployeeGratuityTab: () => <div /> }));
vi.mock('./employee-leave-tab', () => ({ EmployeeLeaveTab: () => <div /> }));
vi.mock('./employee-pension-tab', () => ({ EmployeePensionTab: () => <div /> }));
vi.mock('./employee-advances-tab', () => ({ EmployeeAdvancesTab: () => <div /> }));

beforeEach(() => {
  granted = new Set(['employee:read']);
  current = employee;
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('EmployeeDetail', () => {
  it('hides the pay tabs without payroll:read', () => {
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Salary history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Gratuity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Advances' })).not.toBeInTheDocument();
  });

  it('shows the pay tabs with payroll:read', () => {
    granted.add('payroll:read');
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByRole('tab', { name: 'Salary history' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Gratuity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Advances' })).toBeInTheDocument();
  });

  it('masks the IBAN without employee:manage', () => {
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByTestId('employee-iban')).toHaveTextContent('AE07 **** 3456');
    expect(screen.queryByText('AE070331234567890123456')).not.toBeInTheDocument();
  });

  it('shows the full IBAN and Documents tab with employee:manage', () => {
    granted.add('employee:manage');
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByTestId('employee-iban')).toHaveTextContent('AE070331234567890123456');
    expect(screen.getByRole('tab', { name: 'Documents' })).toBeInTheDocument();
  });

  it('hides the Documents tab without employee:manage', () => {
    render(<EmployeeDetail id="e1" />);
    expect(screen.queryByRole('tab', { name: 'Documents' })).not.toBeInTheDocument();
  });

  it('shows the Leave tab to employee:read holders', () => {
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByRole('tab', { name: 'Leave' })).toBeInTheDocument();
  });

  it('shows the Pension tab only for nationals with payroll:read', () => {
    granted.add('payroll:read');
    const { unmount } = render(<EmployeeDetail id="e1" />);
    expect(screen.queryByRole('tab', { name: 'Pension' })).not.toBeInTheDocument();
    unmount();

    current = { ...employee, isNational: true };
    render(<EmployeeDetail id="e1" />);
    expect(screen.getByRole('tab', { name: 'Pension' })).toBeInTheDocument();
  });

  it('opens a linked tab, marking the active one in ink rather than amber', () => {
    granted.add('payroll:read');
    render(<EmployeeDetail id="e1" initialTab="salary" />);
    const tab = screen.getByRole('tab', { name: 'Salary history' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveClass('text-ink', 'border-ink');
    expect(tab.className).not.toMatch(/brand/);
    expect(screen.getByTestId('salary-tab')).toBeInTheDocument();
  });

  it('falls back to the profile when the linked tab is not available', () => {
    render(<EmployeeDetail id="e1" initialTab="salary" />);
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('profile-tab')).toBeInTheDocument();
  });

  it('hides the Pension tab from a national without payroll:read', () => {
    current = { ...employee, isNational: true };
    render(<EmployeeDetail id="e1" />);
    expect(screen.queryByRole('tab', { name: 'Pension' })).not.toBeInTheDocument();
  });
});
