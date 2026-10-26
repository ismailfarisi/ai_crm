'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, LockOpen, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  PERMISSIONS,
  SUBLEDGER_CONTROLLED_ROLES,
  manualJournalSchema,
  type JournalEntryDto,
  type JournalEntryListParams,
  type LedgerAccountDto,
} from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import {
  useJournals,
  useLedgerAccounts,
  usePeriodLock,
  usePostJournal,
  useReverseJournal,
  useSetPeriodLock,
} from '@/hooks/use-books';
import { useOrganization } from '@/hooks/use-organization';
import { useCan } from '@/lib/session-context';
import { formatDate, formatMoney } from '@/lib/utils';
import { FinanceNav } from '../finance-nav';

const todayIso = () => new Date().toISOString().slice(0, 10);
const yesterdayIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const SOURCES: { value: string; label: string }[] = [
  { value: '', label: 'All sources' },
  { value: 'MANUAL', label: 'Journals, opening balances & revaluations' },
  { value: 'INVOICE', label: 'Invoices & payments' },
  { value: 'BILL', label: 'Bills' },
  { value: 'CREDIT_NOTE', label: 'Credit notes' },
  { value: 'EXPENSE', label: 'Expense claims' },
  { value: 'TRANSFER', label: 'Transfers' },
  { value: 'STOCK', label: 'Stock' },
  { value: 'WORK_ORDER', label: 'Work orders' },
  { value: 'PREPAID', label: 'Prepaid releases' },
  { value: 'PAYROLL', label: 'Payroll' },
  { value: 'SETTLEMENT', label: 'Settlements' },
  { value: 'PENSION_REMITTANCE', label: 'Pension' },
];

const isManual = (e: JournalEntryDto) => e.referenceId.startsWith('journal:');

/** MANUAL also covers opening balances and month-end revaluations. */
function sourceLabel(e: JournalEntryDto): string {
  if (e.referenceType === 'MANUAL') {
    if (isManual(e)) return e.reversesEntryId ? 'Reversal' : 'Manual journal';
    if (e.referenceId.startsWith('opening-balance:')) return 'Opening balance';
    return 'Revaluation';
  }
  return SOURCES.find((s) => s.value === e.referenceType)?.label ?? e.referenceType;
}

/**
 * The general journal: every entry the books hold, the manual journals an
 * accountant posts, and the date the books are locked through.
 */
export function JournalView({ initialAccountId }: { initialAccountId?: string }) {
  const canPost = useCan({ permission: PERMISSIONS.JOURNAL_POST });
  const currency = useOrganization().data?.baseCurrency;
  const { data: accounts = [] } = useLedgerAccounts();
  const [filters, setFilters] = useState<JournalEntryListParams>({
    ledgerAccountId: initialAccountId,
  });
  const { data: entries = [], isLoading } = useJournals(filters);
  const reverse = useReverseJournal();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const reversed = useMemo(
    () => new Set(entries.map((e) => e.reversesEntryId).filter(Boolean) as string[]),
    [entries],
  );
  const accountOptions = [
    { value: '', label: 'All accounts' },
    ...accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description="Every entry in the ledger, newest first. Manual journals post accruals, depreciation and corrections."
        actions={
          canPost && (
            <Button onClick={() => setComposing(true)} data-testid="new-journal-btn">
              <Plus className="size-4" />
              New journal
            </Button>
          )
        }
      />
      <FinanceNav />

      <PeriodLockCard />

      <section aria-labelledby="journal-heading" className="rounded-xl border border-border/60 bg-surface">
        <div className="flex flex-wrap items-end gap-3 border-b border-border/60 p-4">
          <h2 id="journal-heading" className="sr-only">
            Journal entries
          </h2>
          <Input
            label="From"
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
          />
          <Input
            label="To"
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
          />
          <Select
            label="Source"
            value={filters.referenceType ?? ''}
            options={SOURCES}
            onChange={(e) => setFilters({ ...filters, referenceType: e.target.value || undefined })}
          />
          <Select
            label="Account"
            value={filters.ledgerAccountId ?? ''}
            options={accountOptions}
            onChange={(e) => setFilters({ ...filters, ledgerAccountId: e.target.value || undefined })}
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title="No entries match" description="Change the filters, or post a journal." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Narrative</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr
                      className="cursor-pointer hover:bg-surface-muted/40"
                      onClick={() => setOpen(open === entry.id ? null : entry.id)}
                      data-testid={`journal-row-${entry.id}`}
                    >
                      <td className="px-4 py-2 tabular-nums whitespace-nowrap">{formatDate(entry.entryDate)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{entry.entryNumber}</td>
                      <td className="px-4 py-2">
                        <Badge tone={isManual(entry) ? 'info' : 'neutral'}>{sourceLabel(entry)}</Badge>
                      </td>
                      <td className="max-w-md truncate px-4 py-2 text-ink-muted">
                        {entry.memo ?? entry.lines[0]?.description}
                        {reversed.has(entry.id) && <Badge className="ml-2">Reversed</Badge>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(Number(entry.totalAmount), currency)}</td>
                      <td className="px-4 py-2 text-right">
                        {canPost && isManual(entry) && !entry.reversesEntryId && !reversed.has(entry.id) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={reverse.isPending && reverse.variables?.id === entry.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Post a reversal of ${entry.entryNumber} dated today?`))
                                reverse.mutate({ id: entry.id });
                            }}
                          >
                            <Undo2 className="size-4" />
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                    {open === entry.id && (
                      <tr className="bg-surface-muted/30">
                        <td colSpan={6} className="px-4 py-3">
                          <EntryLines entry={entry} currency={currency} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {composing && <JournalDialog accounts={accounts} onClose={() => setComposing(false)} />}
    </div>
  );
}

function EntryLines({ entry, currency }: { entry: JournalEntryDto; currency?: string }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-ink-subtle">
        <tr>
          <th className="py-1 font-medium">Account</th>
          <th className="py-1 font-medium">Description</th>
          <th className="py-1 text-right font-medium">Debit</th>
          <th className="py-1 text-right font-medium">Credit</th>
        </tr>
      </thead>
      <tbody>
        {entry.lines.map((line, i) => (
          <tr key={i}>
            <td className="py-1 font-mono">
              <Link href={`/finance/journal?account=${line.ledgerAccountId}`} className="hover:underline">
                {line.ledgerAccountCode}
              </Link>{' '}
              <span className="font-sans">{line.accountName}</span>
            </td>
            <td className="py-1 text-ink-muted">{line.description}</td>
            <td className="py-1 text-right tabular-nums">
              {Number(line.debit) ? formatMoney(Number(line.debit), currency) : ''}
            </td>
            <td className="py-1 text-right tabular-nums">
              {Number(line.credit) ? formatMoney(Number(line.credit), currency) : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */

function PeriodLockCard() {
  const canLock = useCan({ permission: PERMISSIONS.BOOKS_LOCK });
  const { data: lock } = usePeriodLock();
  const setLock = useSetPeriodLock();
  const [date, setDate] = useState('');

  return (
    <section
      aria-labelledby="lock-heading"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        {lock?.lockedThrough ? (
          <Lock className="mt-0.5 size-5 text-warning" />
        ) : (
          <LockOpen className="mt-0.5 size-5 text-ink-subtle" />
        )}
        <div>
          <h2 id="lock-heading" className="text-sm font-semibold text-ink">
            {lock?.lockedThrough ? `Books locked through ${formatDate(lock.lockedThrough)}` : 'Books are open'}
          </h2>
          <p className="text-sm text-ink-muted">
            {lock?.lockedThrough
              ? 'Nothing dated on or before that day can post, from any document or journal.'
              : 'Lock a period once it is reported or its VAT return is filed, so nothing can change it afterwards.'}
          </p>
        </div>
      </div>
      {canLock && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (date) setLock.mutate(date, { onSuccess: () => setDate('') });
          }}
        >
          <Input
            label="Lock through"
            type="date"
            max={yesterdayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!date} loading={setLock.isPending && !!date}>
            <Lock className="size-4" />
            Lock
          </Button>
          {lock?.lockedThrough && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (window.confirm('Reopen the books? Entries can then be posted into every past period again.'))
                  setLock.mutate(null);
              }}
            >
              Reopen
            </Button>
          )}
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface DraftLine {
  key: number;
  ledgerAccountId: string;
  debit: string;
  credit: string;
  description: string;
}

let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, ledgerAccountId: '', debit: '', credit: '', description: '' });
const cents = (v: string) => Math.round((Number(v) || 0) * 100);

function JournalDialog({ accounts, onClose }: { accounts: LedgerAccountDto[]; onClose: () => void }) {
  const post = usePostJournal();
  const currency = useOrganization().data?.baseCurrency;
  const [entryDate, setEntryDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);

  // Sub-ledger accounts are kept by their documents, and 1000 only groups the
  // bank accounts; the API refuses both.
  const postable = accounts.filter(
    (a) => a.isActive && a.role !== 'CASH' && !(a.role && SUBLEDGER_CONTROLLED_ROLES.includes(a.role)),
  );
  const options = [
    { value: '', label: 'Choose an account…' },
    ...postable.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
  ];

  const debits = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credits = lines.reduce((s, l) => s + cents(l.credit), 0);
  const difference = (debits - credits) / 100;

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    const parsed = manualJournalSchema.safeParse({
      entryDate,
      memo,
      lines: lines
        .filter((l) => l.ledgerAccountId || l.debit || l.credit)
        .map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || null,
        })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the journal');
      return;
    }
    post.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="New journal"
      description="Amounts are in base currency. Lines on a bank account move its balance too."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={post.isPending} disabled={difference !== 0 || debits === 0} data-testid="post-journal-btn">
            Post journal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Input label="Date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          <Input
            label="Narrative"
            placeholder="Depreciation for October"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-[1fr_6.5rem_6.5rem_2rem] items-end gap-2">
              <div className="space-y-1">
                <Select
                  aria-label="Account"
                  value={line.ledgerAccountId}
                  options={options}
                  onChange={(e) => update(line.key, { ledgerAccountId: e.target.value })}
                />
                <Input
                  aria-label="Line description"
                  placeholder="Description (optional)"
                  value={line.description}
                  onChange={(e) => update(line.key, { description: e.target.value })}
                />
              </div>
              <Input
                aria-label="Debit"
                placeholder="Debit"
                type="number"
                step="0.01"
                min="0"
                value={line.debit}
                onChange={(e) => update(line.key, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
              />
              <Input
                aria-label="Credit"
                placeholder="Credit"
                type="number"
                step="0.01"
                min="0"
                value={line.credit}
                onChange={(e) => update(line.key, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove line"
                disabled={lines.length <= 2}
                onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setLines((all) => [...all, blankLine()])}>
            <Plus className="size-4" />
            Add line
          </Button>
        </div>

        <div className="flex justify-end gap-6 border-t border-border/60 pt-3 text-sm tabular-nums">
          <span>Debits {formatMoney(debits / 100, currency)}</span>
          <span>Credits {formatMoney(credits / 100, currency)}</span>
          {debits > 0 && (
            <span className={difference === 0 ? 'text-success' : 'text-danger'}>
              {difference === 0 ? 'Balanced' : `Out by ${formatMoney(Math.abs(difference), currency)}`}
            </span>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
      </div>
    </Dialog>
  );
}
