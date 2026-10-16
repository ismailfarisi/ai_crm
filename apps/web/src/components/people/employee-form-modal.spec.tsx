import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { EmployeeDto } from '@saas/shared';
import { EmployeeFormModal, diffEmployee } from './employee-form-modal';

let granted = new Set<string>();
vi.mock('@/lib/session-context', () => ({
  useCan: (rule: { permission: string }) => granted.has(rule.permission),
}));
vi.mock('@/hooks/use-payroll', () => ({
  usePensionSchemes: () => ({
    data: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'GPSSA', isActive: true },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Dormant', isActive: false },
    ],
  }),
}));

const employee: EmployeeDto = {
  id: 'e1', employeeNumber: 'EMP-0001', firstName: 'Mariam', lastName: 'Al Ali', fullName: 'Mariam Al Ali',
  jobTitle: null, department: null, userId: null, joiningDate: '2024-01-01', leavingDate: null,
  status: 'ACTIVE', nationality: 'AE', isNational: true, paymentMethod: 'BANK', bankName: 'ENBD',
  iban: null, ibanMasked: null, email: null, phone: null,
  wpsPersonId: null, bankRoutingCode: null, pensionSchemeId: null, annualLeaveDaysOverride: null, probationEndDate: null,
  createdAt: '', updatedAt: '',
};

beforeEach(() => {
  granted = new Set(['employee:manage', 'payroll:read']);
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('EmployeeFormModal compliance fields', () => {
  it('maps blank optional numbers and dates to null instead of 0', async () => {
    const onSubmit = vi.fn();
    render(<EmployeeFormModal open onClose={() => {}} existing={{ ...employee, isNational: false }} onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByTestId('employee-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      annualLeaveDaysOverride: null,
      probationEndDate: null,
      wpsPersonId: null,
      bankRoutingCode: null,
      pensionSchemeId: null,
    });
  });

  it('shows the pension select (active schemes only) for nationals with payroll:read', () => {
    render(<EmployeeFormModal open onClose={() => {}} existing={employee} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText('Pension scheme');
    expect(select).toHaveTextContent('GPSSA');
    expect(select).not.toHaveTextContent('Dormant');
  });

  it('hides the pension select for non-nationals and without payroll:read', () => {
    const { unmount } = render(
      <EmployeeFormModal open onClose={() => {}} existing={{ ...employee, isNational: false }} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Pension scheme')).not.toBeInTheDocument();
    unmount();
    granted.delete('payroll:read');
    render(<EmployeeFormModal open onClose={() => {}} existing={employee} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Pension scheme')).not.toBeInTheDocument();
  });

  it('diffEmployee includes the new fields when they change', () => {
    const next = { ...employee, wpsPersonId: '12345678901234', annualLeaveDaysOverride: 35 } as never;
    expect(diffEmployee(employee, next)).toEqual({ wpsPersonId: '12345678901234', annualLeaveDaysOverride: 35 });
  });
});
