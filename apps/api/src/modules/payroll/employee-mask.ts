import {
  PERMISSIONS,
  type EmployeeDto,
  type Permission,
  type SalaryPackageDto,
} from '@saas/shared';

export interface EmployeeView
  extends Omit<EmployeeDto, 'iban' | 'ibanMasked' | 'currentPackage'> {
  iban: string | null;
  ibanLast4: string | null;
  currentPackage: SalaryPackageDto | null;
}

/** What everyone but an employee manager sees of an IBAN. */
export function maskIban(last4: string | null): string | null {
  return last4 ? `•••• ${last4}` : null;
}

/** Pay is private: the directory never carries salary, and only employee managers see a full IBAN. */
export function maskEmployee(
  view: EmployeeView,
  permissions: Permission[],
): EmployeeDto {
  const { iban, ibanLast4, currentPackage, ...rest } = view;
  const dto: EmployeeDto = {
    ...rest,
    ibanMasked: maskIban(ibanLast4),
  };
  if (permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE)) dto.iban = iban;
  if (permissions.includes(PERMISSIONS.PAYROLL_READ))
    dto.currentPackage = currentPackage;
  return dto;
}
