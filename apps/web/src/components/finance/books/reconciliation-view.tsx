'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ban, Check, FileUp, Link2Off } from 'lucide-react';
import {
  PERMISSIONS,
  SUBLEDGER_CONTROLLED_ROLES,
  parseStatementCsv,
  suggestMatches,
  type BankStatementLineDto,
  type LedgerMovementDto,
  type ParsedStatement,
} from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import {
  useImportStatement,
  useLedgerAccounts,
  useReconciliation,
  useStatementLineAction,
} from '@/hooks/use-books';
import { useOrganization } from '@/hooks/use-organization';
import { useCan } from '@/lib/session-context';
import { formatDate, formatMoney } from '@/lib/utils';
import { FinanceNav } from '../finance-nav';

/**
 * Bank reconciliation for one account: import the bank's CSV, match each
 * statement line to the ledger entry that moved the account, and book what
 * the ledger has no entry for (bank charges, interest) in one step.
 */
export function ReconciliationView({ financeAccountId }: { financeAccountId: string }) {
  const canReconcile = useCan({ permission: PERMISSIONS.BANK_RECONCILE });
  const base = useOrganization().data?.baseCurrency;
  const { data, isLoading, error } = useReconciliation(financeAccountId);
  const [filter, setFilter] = useState<'UNMATCHED' | 'ALL'>('UNMATCHED');

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <Alert>Could not load this account.</Alert>;

  const shown = filter === 'ALL' ? data.lines : data.lines.filter((l) => l.status === 'UNMATCHED');
  const gap = Math.round((data.statementBalance - data.ledgerBalance) * 100) / 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Reconcile ${data.accountName}`}
        description="Match each statement line to the entry that moved this account. Lines the books do not have yet can be booked from here."
        actions={
          <Link href="/finance/accounts" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" />
            Accounts
          </Link>
        }
      />
      <FinanceNav />

      {!data.amountsComparable && (
        <Alert tone="warning">
          This account holds {data.currency} and the ledger is kept in {base}, so amounts cannot be compared exactly.
          Check each match yourself.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Statement balance" value={formatMoney(data.statementBalance, data.currency)} />
        <Stat label="Ledger balance" value={formatMoney(data.ledgerBalance, base)} />
        <Stat
          label="Difference"
          value={data.amountsComparable ? formatMoney(gap, base) : '—'}
          tone={data.amountsComparable && gap !== 0 ? 'text-warning' : 'text-success'}
        />
        <Stat
          label="Lines"
          value={`${data.counts.MATCHED} matched · ${data.counts.UNMATCHED} open · ${data.counts.EXCLUDED} excluded`}
        />
      </div>

      {canReconcile && <ImportCard financeAccountId={financeAccountId} />}

      <section aria-labelledby="lines-heading" className="rounded-xl border border-border/60 bg-surface">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 id="lines-heading" className="text-sm font-semibold text-ink">
            Statement lines
          </h2>
          <Select
            aria-label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'UNMATCHED' | 'ALL')}
            options={[
              { value: 'UNMATCHED', label: 'Open lines' },
              { value: 'ALL', label: 'All lines' },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState
            title={data.lines.length ? 'Every line is reconciled' : 'No statement imported yet'}
            description={data.lines.length ? undefined : 'Export a CSV from your bank and import it above.'}
          />
        ) : (
          <ul className="divide-y divide-border/40">
            {shown.map((line) => (
              <StatementLineRow
                key={line.id}
                line={line}
                currency={data.currency}
                movements={data.unreconciledLedger}
                comparable={data.amountsComparable}
                bankLedgerId={data.ledgerAccountId}
                editable={canReconcile}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ledger-heading" className="rounded-xl border border-border/60 bg-surface">
        <h2 id="ledger-heading" className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-ink">
          In the ledger, not on a statement ({data.unreconciledLedger.length})
        </h2>
        {data.unreconciledLedger.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-subtle">Nothing outstanding.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border/40">
              {data.unreconciledLedger.map((m) => (
                <tr key={m.journalEntryId}>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{formatDate(m.entryDate)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.entryNumber}</td>
                  <td className="px-4 py-2 text-ink-muted">{m.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.amount, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface p-4">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
    </div>
  );
}

function ImportCard({ financeAccountId }: { financeAccountId: string }) {
  const importStatement = useImportStatement();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<(ParsedStatement & { fileName: string }) | null>(null);

  return (
    <section aria-labelledby="import-heading" className="rounded-xl border border-border/60 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="import-heading" className="text-sm font-semibold text-ink">
            Import a statement
          </h2>
          <p className="text-sm text-ink-muted">
            A CSV with Date, Description and Amount (or Debit and Credit) columns. Lines already imported are skipped.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          data-testid="statement-file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setParsed({ ...parseStatementCsv(await file.text()), fileName: file.name });
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()}>
          <FileUp className="size-4" />
          Choose CSV
        </Button>
      </div>
      {parsed && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink">
            {parsed.fileName}: {parsed.lines.length} line(s) read
            {parsed.errors.length ? `, ${parsed.errors.length} could not be read` : ''}.
          </p>
          {parsed.errors.length > 0 && (
            <Alert tone="warning">
              {parsed.errors.slice(0, 5).map((e) => (
                <span key={e.row} className="block">
                  {e.row ? `Row ${e.row}: ` : ''}
                  {e.message}
                </span>
              ))}
            </Alert>
          )}
          {parsed.lines.length > 0 && (
            <div className="flex gap-2">
              <Button
                loading={importStatement.isPending}
                onClick={() =>
                  importStatement.mutate(
                    { financeAccountId, lines: parsed.lines },
                    { onSuccess: () => setParsed(null) },
                  )
                }
              >
                Import {parsed.lines.length} line(s)
              </Button>
              <Button variant="ghost" onClick={() => setParsed(null)}>
                Discard
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatementLineRow({
  line,
  currency,
  movements,
  comparable,
  bankLedgerId,
  editable,
}: {
  line: BankStatementLineDto;
  currency: string;
  movements: LedgerMovementDto[];
  comparable: boolean;
  bankLedgerId: string;
  editable: boolean;
}) {
  const act = useStatementLineAction();
  const canPost = useCan({ permission: PERMISSIONS.JOURNAL_POST });
  const { data: accounts = [] } = useLedgerAccounts();
  const suggestions = useMemo(() => suggestMatches(line, movements), [line, movements]);
  const [entryId, setEntryId] = useState(suggestions[0]?.journalEntryId ?? '');
  const [accountId, setAccountId] = useState('');

  const bookable = accounts.filter(
    (a) =>
      a.isActive &&
      a.id !== bankLedgerId &&
      a.role !== 'CASH' &&
      !(a.role && SUBLEDGER_CONTROLLED_ROLES.includes(a.role)),
  );
  // In base currency the API refuses a different amount, so only offer equal
  // ones; across currencies any movement may be the one.
  const others = movements.filter(
    (m) =>
      !suggestions.includes(m) &&
      (!comparable || Math.round(m.amount * 100) === Math.round(line.amount * 100)),
  );
  const moneyIn = line.amount > 0;

  return (
    <li className="space-y-2 px-4 py-3" data-testid={`statement-line-${line.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-ink">
            <span className="tabular-nums text-ink-muted">{formatDate(line.date)}</span> · {line.description}
            {line.reference && <span className="ml-1 text-xs text-ink-subtle">({line.reference})</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`tabular-nums font-medium ${moneyIn ? 'text-success' : 'text-ink'}`}>
            {formatMoney(line.amount, currency)}
          </span>
          {line.status === 'MATCHED' && <Badge tone="success">Matched {line.journalEntryNumber ?? ''}</Badge>}
          {line.status === 'EXCLUDED' && <Badge>Excluded</Badge>}
        </div>
      </div>

      {editable && line.status === 'UNMATCHED' && (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            aria-label="Ledger entry"
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
            options={[
              {
                value: '',
                label: suggestions.length || others.length ? 'Choose a matching entry…' : 'No ledger entry for this amount',
              },
              ...suggestions.map((m) => ({
                value: m.journalEntryId,
                label: `${m.entryNumber} · ${formatDate(m.entryDate)} · ${m.description}`,
              })),
              ...others.map((m) => ({
                  value: m.journalEntryId,
                  label: `${m.entryNumber} · ${formatDate(m.entryDate)} · ${formatMoney(m.amount, null)}`,
                })),
            ]}
          />
          <Button
            size="sm"
            disabled={!entryId}
            loading={act.isPending && act.variables?.kind === 'match'}
            onClick={() => act.mutate({ kind: 'match', lineId: line.id, journalEntryId: entryId })}
          >
            <Check className="size-4" />
            Match
          </Button>
          {canPost && (
            <>
              <span className="px-1 text-xs text-ink-subtle">or book to</span>
              <Select
                aria-label="Book to account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                options={[
                  { value: '', label: moneyIn ? 'Income account…' : 'Expense account…' },
                  ...bookable.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!accountId}
                loading={act.isPending && act.variables?.kind === 'post'}
                onClick={() => act.mutate({ kind: 'post', lineId: line.id, payload: { ledgerAccountId: accountId } })}
              >
                Book &amp; match
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'exclude', lineId: line.id })}>
            <Ban className="size-4" />
            Exclude
          </Button>
        </div>
      )}

      {editable && line.status !== 'UNMATCHED' && (
        <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'unmatch', lineId: line.id })}>
          <Link2Off className="size-4" />
          {line.status === 'MATCHED' ? 'Unmatch' : 'Include again'}
        </Button>
      )}
    </li>
  );
}
