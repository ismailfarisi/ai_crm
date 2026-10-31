/**
 * The employee page's tabs. A plain module (not 'use client') so the server
 * page can read `?tab=salary` and open that tab; other pages link straight to it.
 */
export const EMPLOYEE_TABS = ['profile', 'salary', 'gratuity', 'advances', 'leave', 'pension', 'documents'] as const;
export type EmployeeTab = (typeof EMPLOYEE_TABS)[number];

export const isEmployeeTab = (v: unknown): v is EmployeeTab =>
  typeof v === 'string' && (EMPLOYEE_TABS as readonly string[]).includes(v);

export const employeeTabHref = (employeeId: string, tab: EmployeeTab) => `/people/employees/${employeeId}?tab=${tab}`;
