import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EmployeeDto } from '@saas/shared';
import { EmployeesView } from './employees-view';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: (rule: { permission: string }) => granted.has(rule.permission) }),
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/people/employees' }));

const employees: EmployeeDto[] = [
  {
    id: 'e1', employeeNumber: 'EMP-0001', firstName: 'Amina', lastName: 'Khan', fullName: 'Amina Khan',
    jobTitle: 'Designer', department: 'Studio', userId: null, joiningDate: '2024-01-01', leavingDate: null,
    status: 'ACTIVE', nationality: 'PK', isNational: false, paymentMethod: 'BANK', bankName: null,
    ibanMasked: null, email: null, phone: null, createdAt: '', updatedAt: '',
    wpsPersonId: null, bankRoutingCode: null, pensionSchemeId: null, annualLeaveDaysOverride: null, probationEndDate: null,
  },
  {
    id: 'e2', employeeNumber: 'EMP-0002', firstName: 'Omar', lastName: 'Ali', fullName: 'Omar Ali',
    jobTitle: null, department: null, userId: null, joiningDate: '2024-02-01', leavingDate: null,
    status: 'ON_HOLD', nationality: null, isNational: false, paymentMethod: 'CASH', bankName: null,
    ibanMasked: null, email: null, phone: null, createdAt: '', updatedAt: '',
    wpsPersonId: null, bankRoutingCode: null, pensionSchemeId: null, annualLeaveDaysOverride: null, probationEndDate: null,
  },
];

vi.mock('@/hooks/use-payroll', () => ({
  useEmployees: () => ({ data: employees, isPending: false, isError: false, error: null }),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  granted = new Set(['employee:read']);
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('EmployeesView', () => {
  it('renders a row per employee with number, status and payment method', () => {
    render(<EmployeesView />);
    expect(screen.getByText('EMP-0001')).toBeInTheDocument();
    expect(screen.getByText('Amina Khan')).toBeInTheDocument();
    expect(screen.getByText('Omar Ali')).toBeInTheDocument();
    expect(screen.getAllByText('On hold')).toHaveLength(2); // the filter option and the row badge
  });

  it('hides Add employee without employee:manage', () => {
    render(<EmployeesView />);
    expect(screen.queryByRole('button', { name: /add employee/i })).not.toBeInTheDocument();
  });

  it('shows Add employee with employee:manage', () => {
    granted.add('employee:manage');
    render(<EmployeesView />);
    expect(screen.getByRole('button', { name: /add employee/i })).toBeInTheDocument();
  });
});
