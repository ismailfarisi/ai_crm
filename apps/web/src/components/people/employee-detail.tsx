'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { PERMISSIONS, packageGross, type EmployeeDto, type SalaryPackageDto } from '@saas/shared';
import {
  useAddSalaryPackage,
  useEmployee,
  useSalaryPackages,
  useUpdateEmployee,
} from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, PageHeader } from '@/components/ui/primitives';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { useCan } from '@/lib/session-context';
import { EmployeeStatusBadge } from './employees-view';
import { EmployeeFormModal, diffEmployee } from './employee-form-modal';
import { SalaryPackageModal } from './salary-package-modal';
import { EmployeeGratuityTab } from './employee-gratuity-tab';
import { EmployeeAdvancesTab } from './employee-advances-tab';

type TabKey = 'profile' | 'salary' | 'gratuity' | 'advances' | 'documents';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-sm text-ink">{children || '—'}</dd>
    </div>
  );
}

function ProfileTab({ employee, canManage }: { employee: EmployeeDto; canManage: boolean }) {
  const update = useUpdateEmployee();
  const [editing, setEditing] = useState(false);

  return (
    <Card data-testid="profile-tab">
      <CardBody>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Job title">{employee.jobTitle}</Field>
          <Field label="Department">{employee.department}</Field>
          <Field label="Email">{employee.email}</Field>
          <Field label="Phone">{employee.phone}</Field>
          <Field label="Nationality">{employee.nationality}</Field>
          <Field label="Joined">{day(employee.joiningDate)}</Field>
          <Field label="Left">{day(employee.leavingDate)}</Field>
          <Field label="Paid by">{employee.paymentMethod === 'BANK' ? 'Bank transfer' : 'Cash'}</Field>
          {employee.paymentMethod === 'BANK' && <Field label="Bank">{employee.bankName}</Field>}
          {employee.paymentMethod === 'BANK' && (
            <div>
              <dt className="text-xs text-ink-subtle">IBAN</dt>
              <dd data-testid="employee-iban" className="font-mono text-sm text-ink">
                {(canManage ? employee.iban : employee.ibanMasked) || '—'}
              </dd>
            </div>
          )}
        </dl>
        {canManage && (
          <div className="mt-4">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
        )}
      </CardBody>
      {canManage && (
        <EmployeeFormModal
          open={editing}
          onClose={() => setEditing(false)}
          existing={employee}
          isLoading={update.isPending}
          onSubmit={async (payload) => {
            const input = diffEmployee(employee, payload);
            if (Object.keys(input).length === 0) return;
            await update.mutateAsync({ id: employee.id, input });
          }}
        />
      )}
    </Card>
  );
}

function SalaryTab({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useSalaryPackages(employeeId);
  const add = useAddSalaryPackage();
  const [open, setOpen] = useState(false);

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !data) {
    return <EmptyState title="Couldn't load salary history" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  return (
    <div className="space-y-4" data-testid="salary-tab">
      <div className="flex justify-end">
        <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Record change
          </Button>
        </Can>
      </div>
      <Card>
        <CardBody>
          {data.length === 0 ? (
            <p className="text-sm text-ink-muted">No salary package yet. Record one before including this employee in payroll.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">From</th>
                  <th className="py-2 text-right font-medium">Basic</th>
                  <th className="py-2 text-right font-medium">Housing</th>
                  <th className="py-2 text-right font-medium">Transport</th>
                  <th className="py-2 text-right font-medium">Other</th>
                  <th className="py-2 text-right font-medium">Gross</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p: SalaryPackageDto) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2 whitespace-nowrap">{day(p.effectiveFrom)}</td>
                    <td className="py-2 text-right tabular-nums">{money(p.basic)}</td>
                    <td className="py-2 text-right tabular-nums">{money(p.housing)}</td>
                    <td className="py-2 text-right tabular-nums">{money(p.transport)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {money(p.otherAllowances.reduce((s, a) => s + a.amount, 0))}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">{money(p.gross ?? packageGross(p))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <SalaryPackageModal
        open={open}
        onClose={() => setOpen(false)}
        isLoading={add.isPending}
        onSubmit={async (input) => {
          await add.mutateAsync({ id: employeeId, input });
        }}
      />
    </div>
  );
}

export function EmployeeDetail({ id }: { id: string }) {
  const { data: employee, isPending, isError, error } = useEmployee(id);
  const canPay = useCan({ permission: PERMISSIONS.PAYROLL_READ });
  const canManage = useCan({ permission: PERMISSIONS.EMPLOYEE_MANAGE });
  const [tab, setTab] = useState<TabKey>('profile');

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !employee) {
    return <EmptyState title="Couldn't load this employee" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(canPay
      ? ([
          { key: 'salary', label: 'Salary history' },
          { key: 'gratuity', label: 'Gratuity' },
          { key: 'advances', label: 'Advances' },
        ] as const)
      : []),
    ...(canManage ? ([{ key: 'documents', label: 'Documents' }] as const) : []),
  ];

  return (
    <div className="space-y-6">
      <Link href="/people/employees" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Employees
      </Link>
      <PageHeader
        title={employee.fullName}
        description={[employee.employeeNumber, employee.jobTitle, employee.department].filter(Boolean).join(' · ')}
        actions={<EmployeeStatusBadge status={employee.status} />}
      />

      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-subtle hover:border-border hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'profile' && <ProfileTab employee={employee} canManage={canManage} />}
      {tab === 'salary' && canPay && <SalaryTab employeeId={id} />}
      {tab === 'gratuity' && canPay && <EmployeeGratuityTab employeeId={id} />}
      {tab === 'advances' && canPay && <EmployeeAdvancesTab employeeId={id} />}
      {tab === 'documents' && canManage && <AttachmentsPanel ownerType="EMPLOYEE" ownerId={id} canEdit />}
    </div>
  );
}
