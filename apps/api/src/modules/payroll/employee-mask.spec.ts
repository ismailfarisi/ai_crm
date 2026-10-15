import { PERMISSIONS } from '@saas/shared';
import { maskEmployee } from './employee-mask';

const view: any = { id: 'e1', employeeNumber: 'EMP-2026-0001', firstName: 'Ada', lastName: 'Okafor', iban: 'AE070331234567890123456', ibanLast4: '3456', currentPackage: { basic: 6000 }, createdAt: new Date(), updatedAt: new Date() };

it('directory readers see no pay and a masked IBAN', () => {
  const dto = maskEmployee(view, [PERMISSIONS.EMPLOYEE_READ]);
  expect(dto).not.toHaveProperty('iban');
  expect(dto).not.toHaveProperty('currentPackage');
  expect(dto.ibanMasked).toBe('•••• 3456');
});
it('payroll readers see the package, not the IBAN', () => {
  const dto = maskEmployee(view, [PERMISSIONS.EMPLOYEE_READ, PERMISSIONS.PAYROLL_READ]);
  expect(dto.currentPackage).toEqual({ basic: 6000 });
  expect(dto).not.toHaveProperty('iban');
});
it('employee managers see the full IBAN', () => {
  expect(maskEmployee(view, [PERMISSIONS.EMPLOYEE_MANAGE]).iban).toBe('AE070331234567890123456');
});
