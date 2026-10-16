'use client';

import Link from 'next/link';
import type { EmployeeDto } from '@saas/shared';
import { usePensionSchemes } from '@/hooks/use-payroll';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { PENSION_BASE_LABELS } from './payroll-settings-view';
import { money } from './payroll-format';

/** Nationals only: the scheme they contribute to, with its rates. Changing it is an employee edit. */
export function EmployeePensionTab({ employee }: { employee: EmployeeDto }) {
  const { data, isPending, isError, error } = usePensionSchemes();

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !data) {
    return <EmptyState title="Couldn't load pension schemes" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }
  const scheme = data.find((s) => s.id === employee.pensionSchemeId) ?? null;
  const limits = scheme
    ? [
        scheme.minSalary != null ? `min ${money(scheme.minSalary)}` : null,
        scheme.maxSalary != null ? `max ${money(scheme.maxSalary)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Card data-testid="pension-tab">
      <CardBody className="space-y-4">
        {scheme ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-subtle">Scheme</dt>
              <dd className="text-sm text-ink">
                {scheme.name} {!scheme.isActive && <Badge tone="warning">Inactive</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Employee</dt>
              <dd className="text-sm tabular-nums text-ink">{scheme.employeePct}%</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Employer</dt>
              <dd className="text-sm tabular-nums text-ink">{scheme.employerPct}%</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Calculated on</dt>
              <dd className="text-sm text-ink">
                {PENSION_BASE_LABELS[scheme.base]}
                {limits.length > 0 && ` (${limits.join(', ')})`}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">
            No pension scheme assigned. Pick one when editing this employee, or payroll will flag them.
          </p>
        )}
        <Link href="/people/settings" className="text-sm font-medium text-accent hover:underline">
          Pension schemes in Settings
        </Link>
      </CardBody>
    </Card>
  );
}
