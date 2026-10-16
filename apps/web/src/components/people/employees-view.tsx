'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Users } from 'lucide-react';
import {
  PERMISSIONS,
  type CreateEmployeePayload,
  type EmployeeDto,
  type EmployeeStatus,
} from '@saas/shared';
import { useCreateEmployee, useEmployees } from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { PeopleNav } from './people-nav';
import { EmployeeFormModal } from './employee-form-modal';

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  LEFT: 'Left',
};

const STATUS_TONES: Record<EmployeeStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  LEFT: 'neutral',
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function EmployeesView() {
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError, error } = useEmployees(status ? { status } : {});
  const create = useCreateEmployee();

  const columns = useMemo<ColumnDef<EmployeeDto, unknown>[]>(
    () => [
      {
        accessorKey: 'employeeNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="No." />,
        cell: ({ row }) => (
          <Link href={`/people/employees/${row.original.id}`} className="font-medium text-accent hover:underline">
            {row.original.employeeNumber}
          </Link>
        ),
      },
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="text-ink">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'jobTitle',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.jobTitle ?? '—'}</span>,
      },
      {
        accessorKey: 'department',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.department ?? '—'}</span>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'paymentMethod',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid by" />,
        cell: ({ row }) => (
          <span className="text-ink-muted">{row.original.paymentMethod === 'BANK' ? 'Bank' : 'Cash'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Your staff directory. Pay details are visible only with payroll access."
        actions={
          <>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
              className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Can permission={PERMISSIONS.EMPLOYEE_MANAGE}>
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                Add employee
              </Button>
            </Can>
          </>
        }
      />
      <PeopleNav />

      {isError ? (
        <EmptyState
          title="Couldn't load employees"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data ?? []}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="fullName"
          cardSubtitleKey="jobTitle"
          searchPlaceholder="Search name, number or title…"
          emptyTitle="No employees yet"
          emptyDescription="Add the first one to start running payroll."
          emptyIcon={<Users className="size-8 text-ink-muted" />}
        />
      )}

      <Can permission={PERMISSIONS.EMPLOYEE_MANAGE}>
        <EmployeeFormModal
          open={adding}
          onClose={() => setAdding(false)}
          isLoading={create.isPending}
          onSubmit={async (payload) => {
            await create.mutateAsync(payload as CreateEmployeePayload);
          }}
        />
      </Can>
    </div>
  );
}
