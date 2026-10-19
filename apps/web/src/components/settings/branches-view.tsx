'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { branchSchema, EMIRATE_NAMES, EMIRATES, PERMISSIONS, type BranchDto } from '@saas/shared';
import { useBranches, useSaveBranch } from '@/hooks/use-organization';
import { ApiError } from '@/lib/api/client';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';

type FormValues = z.input<typeof branchSchema>;
type SubmitValues = z.output<typeof branchSchema>;

const EMIRATE_OPTIONS = EMIRATES.map((code) => ({ value: code, label: EMIRATE_NAMES[code] }));

const BLANK: FormValues = {
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  emirate: null,
  isHeadOffice: false,
  invoicePrefix: '',
  isActive: true,
};

/**
 * The organisation's offices. A single-office tenant sees one row and never
 * needs this page; nothing elsewhere asks them to pick a branch.
 */
export function BranchesView() {
  const canEdit = useCan({ permission: PERMISSIONS.ORG_UPDATE });
  const { data: branches, isPending } = useBranches();
  // `null` = closed, `'new'` = adding, otherwise the branch being edited.
  const [editing, setEditing] = useState<BranchDto | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Branches"
        description="Your offices. UAE VAT needs a registered address and emirate for each one."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" />
              Add branch
            </Button>
          ) : undefined
        }
      />

      {isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : !branches || branches.length === 0 ? (
        <EmptyState title="No branches yet" description="Add your head office to get started." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Emirate</th>
                <th className="px-4 py-2 font-medium">Invoice prefix</th>
                <th className="px-4 py-2 font-medium">Head office</th>
                <th className="px-4 py-2 font-medium">Active</th>
                {canEdit && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td className="px-4 py-2 text-ink">{branch.name}</td>
                  <td className="px-4 py-2 text-ink-muted">{branch.emirate ? EMIRATE_NAMES[branch.emirate] : '—'}</td>
                  <td className="px-4 py-2 font-mono text-ink-muted">{branch.invoicePrefix ?? '—'}</td>
                  <td className="px-4 py-2">{branch.isHeadOffice ? <Badge>Head office</Badge> : '—'}</td>
                  <td className="px-4 py-2 text-ink-muted">{branch.isActive ? 'Yes' : 'No'}</td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(branch)}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {canEdit && <BranchDialog target={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BranchDialog({ target, onClose }: { target: BranchDto | 'new' | null; onClose: () => void }) {
  const save = useSaveBranch();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({ resolver: zodResolver(branchSchema), defaultValues: BLANK });

  useEffect(() => {
    if (target === null) return;
    setServerError(null);
    reset(
      target === 'new'
        ? BLANK
        : {
            name: target.name,
            addressLine1: target.addressLine1 ?? '',
            addressLine2: target.addressLine2 ?? '',
            city: target.city ?? '',
            emirate: target.emirate,
            isHeadOffice: target.isHeadOffice,
            invoicePrefix: target.invoicePrefix ?? '',
            isActive: target.isActive,
          },
    );
  }, [target, reset]);

  const onSubmit = handleSubmit(async (payload) => {
    setServerError(null);
    try {
      await save.mutateAsync({ id: target !== null && target !== 'new' ? target.id : undefined, payload });
      onClose();
    } catch (error) {
      setServerError(error instanceof ApiError && error.message ? error.message : 'Could not save the branch');
    }
  });

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target === 'new' ? 'Add branch' : 'Edit branch'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="branch-form" loading={isSubmitting}>
            Save branch
          </Button>
        </>
      }
    >
      <form id="branch-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <Input label="Address line 1" error={errors.addressLine1?.message} {...register('addressLine1')} />
        <Input label="Address line 2" error={errors.addressLine2?.message} {...register('addressLine2')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="City" error={errors.city?.message} {...register('city')} />
          <Select
            label="Emirate"
            placeholder="Select…"
            options={EMIRATE_OPTIONS}
            error={errors.emirate?.message}
            {...register('emirate')}
          />
        </div>
        <Input
          label="Invoice prefix"
          hint="2 to 6 letters or digits. Leave blank to use the default numbering."
          className="uppercase"
          error={errors.invoicePrefix?.message}
          {...register('invoicePrefix')}
        />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" {...register('isHeadOffice')} />
          Head office
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" {...register('isActive')} />
          Active
        </label>
        {serverError && <Alert>{serverError}</Alert>}
      </form>
    </Dialog>
  );
}
