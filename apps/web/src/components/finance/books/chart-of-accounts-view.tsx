'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  NORMAL_BALANCE,
  PERMISSIONS,
  createLedgerAccountSchema,
  type LedgerAccountDto,
  type LedgerAccountType,
} from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Alert, Badge, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useLedgerAccountAction, useLedgerAccounts, useTrialBalance } from '@/hooks/use-books';
import { useOrganization } from '@/hooks/use-organization';
import { useCan } from '@/lib/session-context';
import { formatMoney } from '@/lib/utils';
import { FinanceNav } from '../finance-nav';

const TYPES: { value: LedgerAccountType; label: string }[] = [
  { value: 'ASSET', label: 'Assets' },
  { value: 'LIABILITY', label: 'Liabilities' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expenses' },
];

/** Accounts in code order, each followed by its children, with their depth. */
function tree(accounts: LedgerAccountDto[]): { account: LedgerAccountDto; depth: number }[] {
  const children = new Map<string | null, LedgerAccountDto[]>();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    const parent = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  const out: { account: LedgerAccountDto; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of (children.get(parent) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
      out.push({ account: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The chart of accounts: the system's own accounts, which the application
 * posts to by role, and the ones a tenant adds for its own reporting.
 */
export function ChartOfAccountsView() {
  const canManage = useCan({ permission: PERMISSIONS.LEDGER_MANAGE });
  const currency = useOrganization().data?.baseCurrency;
  const { data: accounts = [], isLoading } = useLedgerAccounts();
  const { data: trial } = useTrialBalance();
  const act = useLedgerAccountAction();
  const [editing, setEditing] = useState<LedgerAccountDto | 'new' | null>(null);

  const balances = useMemo(
    () => new Map((trial?.rows ?? []).map((r) => [r.ledgerAccountId, r.balance])),
    [trial],
  );
  const rows = useMemo(() => tree(accounts), [accounts]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of accounts"
        description="System accounts are posted to automatically and keep their codes. Add your own for anything else you report on."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')} data-testid="new-ledger-account-btn">
              <Plus className="size-4" />
              New account
            </Button>
          )
        }
      />
      <FinanceNav />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        TYPES.map((type) => {
          const section = rows.filter((r) => r.account.type === type.value);
          if (!section.length) return null;
          return (
            <section
              key={type.value}
              aria-labelledby={`coa-${type.value}`}
              className="rounded-xl border border-border/60 bg-surface"
            >
              <h2 id={`coa-${type.value}`} className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-ink">
                {type.label}
                <span className="ml-2 text-xs font-normal text-ink-subtle">
                  normally {NORMAL_BALANCE[type.value].toLowerCase()}
                </span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border/40">
                    {section.map(({ account, depth }) => (
                      <tr key={account.id} className={account.isActive ? '' : 'opacity-60'}>
                        <td className="w-24 px-4 py-2 font-mono text-xs">{account.code}</td>
                        <td className="px-4 py-2" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
                          <Link
                            href={`/finance/journal?account=${account.id}`}
                            className="text-ink hover:underline"
                            title="Entries on this account"
                          >
                            {account.name}
                          </Link>
                          {account.isSystem && <Badge className="ml-2">System</Badge>}
                          {!account.isActive && <Badge tone="warning" className="ml-2">Inactive</Badge>}
                          {account.description && (
                            <p className="max-w-[18rem] truncate text-xs text-ink-subtle sm:max-w-sm lg:max-w-md">
                              {account.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                          {formatMoney(balances.get(account.id) ?? 0, currency)}
                        </td>
                        <td className="w-24 px-4 py-2 text-right whitespace-nowrap">
                          {canManage && (
                            <>
                              <Button size="icon" variant="ghost" aria-label={`Edit ${account.name}`} onClick={() => setEditing(account)}>
                                <Pencil className="size-4" />
                              </Button>
                              {!account.isSystem && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Delete ${account.name}`}
                                  onClick={() => {
                                    if (window.confirm(`Delete ${account.code} ${account.name}?`))
                                      act.mutate({ kind: 'delete', id: account.id });
                                  }}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {editing && (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AccountDialog({
  account,
  accounts,
  onClose,
}: {
  account: LedgerAccountDto | null;
  accounts: LedgerAccountDto[];
  onClose: () => void;
}) {
  const act = useLedgerAccountAction();
  const [form, setForm] = useState({
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: (account?.type ?? 'EXPENSE') as LedgerAccountType,
    parentId: account?.parentId ?? '',
    description: account?.description ?? '',
    isActive: account?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const parents = [
    { value: '', label: 'None (top level)' },
    ...accounts
      .filter((a) => a.type === form.type && a.id !== account?.id)
      .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
  ];

  const submit = () => {
    setError(null);
    if (!account) {
      const parsed = createLedgerAccountSchema.safeParse({ ...form, parentId: form.parentId || null });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Check the account');
        return;
      }
      act.mutate({ kind: 'create', payload: parsed.data }, { onSuccess: onClose });
      return;
    }
    act.mutate(
      {
        kind: 'update',
        id: account.id,
        payload: {
          name: form.name,
          description: form.description || null,
          parentId: form.parentId || null,
          ...(account.isSystem ? {} : { code: form.code, isActive: form.isActive }),
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? `Edit ${account.code}` : 'New account'}
      description={account?.isSystem ? 'A system account keeps its code and stays active: the application posts to it.' : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={act.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Input
            label="Code"
            value={form.code}
            disabled={account?.isSystem}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <Select
          label="Type"
          value={form.type}
          disabled={Boolean(account)}
          options={TYPES.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(e) => setForm({ ...form, type: e.target.value as LedgerAccountType, parentId: '' })}
        />
        <Select
          label="Rolls up into"
          value={form.parentId}
          options={parents}
          onChange={(e) => setForm({ ...form, parentId: e.target.value })}
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {account && !account.isSystem && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active: journals can post to it
          </label>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Dialog>
  );
}
