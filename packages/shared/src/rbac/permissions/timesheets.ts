import type { PermissionDomain, PermissionValues } from './domain';

export const TIMESHEET_PERMISSIONS = {
  TIMESHEET_READ: 'timesheet:read',
  TIMESHEET_MANAGE: 'timesheet:manage',
} as const;

type TimesheetPermission = PermissionValues<typeof TIMESHEET_PERMISSIONS>;

export const timesheetsDomain: PermissionDomain<TimesheetPermission> = {
  key: 'timesheet',
  label: 'Timesheets',
  permissions: TIMESHEET_PERMISSIONS,
  descriptions: {
    [TIMESHEET_PERMISSIONS.TIMESHEET_READ]: 'View hours worked by employee, job and day — not pay',
    [TIMESHEET_PERMISSIONS.TIMESHEET_MANAGE]: 'Enter and correct timesheet hours for any employee',
  },
  groupPermissions: Object.values(TIMESHEET_PERMISSIONS),
  grants: {
    admin: Object.values(TIMESHEET_PERMISSIONS),
    // Supervisors enter their crew's hours.
    manager: Object.values(TIMESHEET_PERMISSIONS),
    // The floor sees where its hours went.
    member: [TIMESHEET_PERMISSIONS.TIMESHEET_READ],
    viewer: [],
  },
};
