'use client';

import { useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import {
  PENSION_BASES,
  PERMISSIONS,
  createPensionSchemeSchema,
  payrollSettingsSchema,
  type CreatePensionSchemeInput,
  type CreatePensionSchemePayload,
  type PayrollSettingsDto,
  type PayrollSettingsInput,
  type PayrollSettingsPayload,
  type PensionBase,
  type PensionSchemeDto,
} from '@saas/shared';
import {
  useCreatePensionScheme,
  useDeletePensionScheme,
  usePayrollSettings,
  usePensionSchemes,
  useSavePayrollSettings,
  useUpdatePensionScheme,
} from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCan } from '@/lib/session-context';
import { PeopleNav } from './people-nav';
import { money } from './payroll-format';

export const PENSION_BASE_LABELS: Record<PensionBase, string> = {
  BASIC: 'Basic',
  BASIC_HOUSING: 'Basic + housing',
  GROSS: 'Gross',
};

const optionalNumber = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? null : Number(v));

const WPS_FIELDS = ['employerIdType', 'employerId', 'payerRoutingCode'] as const;
const settingsResolver = zodResolver(payrollSettingsSchema);

/**
 * With WPS off its fields are hidden, so one that fails validation must not block Save with an
 * invisible error. Valid stored values go through unchanged; only an invalid one is sent as null.
 */
const wpsAwareResolver: Resolver<PayrollSettingsInput, unknown, PayrollSettingsPayload> = async (values, context, options) => {
  const first = await settingsResolver(values, context, options);
  if (values.wpsEnabled || !Object.keys(first.errors).length) return first;
  const blanked = { ...values };
  for (const key of WPS_FIELDS) {
    if (!(key in first.errors)) continue;
    if (key === 'employerIdType') blanked.employerIdType = null;
    else blanked[key] = '';
  }
  return settingsResolver(blanked, context, options);
};

function toSettingsDefaults(s?: PayrollSettingsDto): PayrollSettingsInput {
  return {
    wpsEnabled: s?.wpsEnabled ?? false,
    employerIdType: s?.employerIdType ?? null,
    employerId: s?.employerId ?? '',
    payerRoutingCode: s?.payerRoutingCode ?? '',
    annualLeaveDays: s?.annualLeaveDays ?? 30,
  };
}

function SettingsCard({ settings }: { settings: PayrollSettingsDto }) {
  const canManage = useCan({ permission: PERMISSIONS.PAYROLL_MANAGE });
  const save = useSavePayrollSettings();
  const form = useForm<PayrollSettingsInput, unknown, PayrollSettingsPayload>({
    resolver: wpsAwareResolver,
    defaultValues: toSettingsDefaults(settings),
  });
  useEffect(() => {
    form.reset(toSettingsDefaults(settings));
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = form.formState.errors;
  const wpsEnabled = form.watch('wpsEnabled');

  return (
    <form
      data-testid="payroll-settings-form"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await save.mutateAsync(values);
        } catch {
          // Toasted by the mutation.
        }
      })}
    >
      <fieldset disabled={!canManage} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Wages Protection System (WPS)</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" {...form.register('wpsEnabled')} />
              <span>Generate a WPS salary file for bank-paid runs</span>
            </label>
            {wpsEnabled && (
              <div className="space-y-3" data-testid="wps-fields">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    label="Employer ID type"
                    placeholder="Choose…"
                    options={[
                      { value: 'MOHRE', label: 'MOHRE establishment' },
                      { value: 'FREE_ZONE', label: 'Free zone' },
                    ]}
                    {...form.register('employerIdType', { setValueAs: (v: string) => (v ? v : null) })}
                    error={errors.employerIdType?.message}
                  />
                  <Input label="Employer ID" {...form.register('employerId')} error={errors.employerId?.message} />
                  <Input
                    label="Payer routing code"
                    inputMode="numeric"
                    {...form.register('payerRoutingCode')}
                    error={errors.payerRoutingCode?.message}
                  />
                </div>
                <p className="text-xs text-ink-subtle">
                  MOHRE: 13-digit establishment ID; free zone: the authority&apos;s ID
                </p>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave</CardTitle>
          </CardHeader>
          <CardBody>
            <Input
              label="Annual leave days"
              type="number"
              min={30}
              max={60}
              hint="30 to 60 calendar days a year; an employee can be set to their own figure."
              containerClassName="max-w-xs"
              {...form.register('annualLeaveDays')}
              error={errors.annualLeaveDays?.message}
            />
          </CardBody>
        </Card>
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" data-testid="btn-save-settings" loading={save.isPending}>
              Save settings
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

const SCHEME_EMPTY: CreatePensionSchemeInput = {
  name: '',
  employeePct: '' as unknown as number,
  employerPct: '' as unknown as number,
  base: 'BASIC',
  minSalary: null,
  maxSalary: null,
};

function schemeDefaults(s?: PensionSchemeDto | null): CreatePensionSchemeInput {
  if (!s) return SCHEME_EMPTY;
  return {
    name: s.name,
    employeePct: s.employeePct,
    employerPct: s.employerPct,
    base: s.base,
    minSalary: s.minSalary,
    maxSalary: s.maxSalary,
  };
}

function PensionSchemeModal({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: PensionSchemeDto | null;
}) {
  const create = useCreatePensionScheme();
  const update = useUpdatePensionScheme();
  const form = useForm<CreatePensionSchemeInput, unknown, CreatePensionSchemePayload>({
    resolver: zodResolver(createPensionSchemeSchema),
    defaultValues: schemeDefaults(existing),
  });
  useEffect(() => {
    if (open) form.reset(schemeDefaults(existing));
  }, [open, existing]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onClose={onClose} title={existing ? 'Edit pension scheme' : 'Add pension scheme'}>
      <form
        data-testid="pension-scheme-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            if (existing) await update.mutateAsync({ id: existing.id, input: values });
            else await create.mutateAsync(values);
          } catch {
            return;
          }
          onClose();
        })}
      >
        <Input label="Name" {...form.register('name')} error={errors.name?.message} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Employee %"
            type="number"
            step="0.01"
            {...form.register('employeePct')}
            error={errors.employeePct?.message}
          />
          <Input
            label="Employer %"
            type="number"
            step="0.01"
            {...form.register('employerPct')}
            error={errors.employerPct?.message}
          />
        </div>
        <Select
          label="Calculated on"
          options={PENSION_BASES.map((b) => ({ value: b, label: PENSION_BASE_LABELS[b] }))}
          {...form.register('base')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Minimum salary (optional)"
            type="number"
            step="0.01"
            {...form.register('minSalary', { setValueAs: optionalNumber })}
            error={errors.minSalary?.message}
          />
          <Input
            label="Maximum salary (optional)"
            type="number"
            step="0.01"
            {...form.register('maxSalary', { setValueAs: optionalNumber })}
            error={errors.maxSalary?.message}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending || update.isPending}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PensionSchemesCard() {
  const { data, isPending, isError, error } = usePensionSchemes();
  const update = useUpdatePensionScheme();
  const remove = useDeletePensionScheme();
  const [editing, setEditing] = useState<PensionSchemeDto | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card data-testid="pension-schemes">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Pension schemes</CardTitle>
        <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add scheme
          </Button>
        </Can>
      </CardHeader>
      <CardBody className="space-y-3 overflow-x-auto">
        <p className="text-xs text-ink-subtle">Presets start inactive — check the rates with the fund before activating</p>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <EmptyState
            title="Couldn't load pension schemes"
            description={error instanceof Error ? error.message : 'Please try again.'}
          />
        ) : data.length === 0 ? (
          <p className="text-sm text-ink-muted">No pension schemes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-subtle">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 text-right font-medium">Employee %</th>
                <th className="py-2 text-right font-medium">Employer %</th>
                <th className="py-2 font-medium">Base</th>
                <th className="py-2 text-right font-medium">Min</th>
                <th className="py-2 text-right font-medium">Max</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Assigned</th>
                <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
                  <th className="py-2" />
                </Can>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t border-border/40" data-testid={`scheme-${s.id}`}>
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2 text-right tabular-nums">{s.employeePct}</td>
                  <td className="py-2 text-right tabular-nums">{s.employerPct}</td>
                  <td className="py-2">{PENSION_BASE_LABELS[s.base]}</td>
                  <td className="py-2 text-right tabular-nums">{s.minSalary == null ? '—' : money(s.minSalary)}</td>
                  <td className="py-2 text-right tabular-nums">{s.maxSalary == null ? '—' : money(s.maxSalary)}</td>
                  <td className="py-2">
                    <Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.assignedCount}</td>
                  <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => update.mutate({ id: s.id, input: { isActive: !s.isActive } })}
                        >
                          {s.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={s.assignedCount > 0}
                          title={s.assignedCount > 0 ? 'Assigned to employees — move them to another scheme first' : undefined}
                          onClick={() => {
                            if (window.confirm(`Delete ${s.name}?`)) remove.mutate(s.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </Can>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
        {adding && <PensionSchemeModal open onClose={() => setAdding(false)} />}
        {editing && <PensionSchemeModal open existing={editing} onClose={() => setEditing(null)} />}
      </Can>
    </Card>
  );
}

export function PayrollSettingsView() {
  const { data, isPending, isError, error } = usePayrollSettings();

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll settings" description="WPS, annual leave and pension schemes." />
      <PeopleNav />
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : isError || !data ? (
        <EmptyState
          title="Couldn't load payroll settings"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <SettingsCard settings={data} />
      )}
      <PensionSchemesCard />
    </div>
  );
}
