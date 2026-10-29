'use client';

import { useMemo, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import type { BankStatementLineDto, LedgerMovementDto, ReconciliationSuggestion } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import { useAutoMatch, useCreateBankMatch } from '@/hooks/use-books';
import { formatDate, formatMoney } from '@/lib/utils';

const cents = (n: number) => Math.round(n * 100);

const KIND_LABEL: Record<ReconciliationSuggestion['kind'], string> = {
  ONE_TO_ONE: 'Same amount',
  ONE_LINE_MANY_ENTRIES: 'One deposit, several entries',
  MANY_LINES_ONE_ENTRY: 'One entry, several lines',
};

/** Items moving money the same way as `start` first, then nearest in date. */
function byRelevance<T>(
  start: Pick<BankStatementLineDto, 'amount' | 'date'>,
  amount: (t: T) => number,
  date: (t: T) => string,
): (a: T, b: T) => number {
  const sign = Math.sign(start.amount);
  const at = Date.parse(start.date);
  const away = (t: T) => Math.abs(Date.parse(date(t).slice(0, 10)) - at);
  return (a, b) =>
    Number(Math.sign(amount(b)) === sign) - Number(Math.sign(amount(a)) === sign) || away(a) - away(b);
}

/** Shown at most; the rest arrive as these are accepted. */
const SHOWN = 20;

/**
 * Matches Kerf proposes. Certain ones — the only pairing either side could
 * make — can be applied together; every other one is a person's decision,
 * one at a time.
 */
export function SuggestionsPanel({
  financeAccountId,
  suggestions,
  lines,
  movements,
  currency,
  base,
  editable,
}: {
  financeAccountId: string;
  suggestions: ReconciliationSuggestion[];
  lines: BankStatementLineDto[];
  movements: LedgerMovementDto[];
  currency: string;
  base: string | undefined;
  editable: boolean;
}) {
  const accept = useCreateBankMatch();
  const auto = useAutoMatch();
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const entryById = useMemo(() => new Map(movements.map((m) => [m.journalEntryId, m])), [movements]);
  const certain = suggestions.filter((s) => s.certain).length;

  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="rounded-xl border border-border/60 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 id="suggestions-heading" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="size-4 text-brand" />
          Suggested matches ({suggestions.length})
        </h2>
        {editable && certain > 0 && (
          <Button size="sm" loading={auto.isPending} onClick={() => auto.mutate(financeAccountId)}>
            Match {certain} certain
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border/40">
        {suggestions.slice(0, SHOWN).map((s) => {
          const key = `${s.lineIds.join(',')}|${s.journalEntryIds.join(',')}`;
          return (
            <li key={key} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_1fr_auto]" data-testid="suggestion">
              <div className="space-y-0.5 text-sm">
                {s.lineIds.map((id) => {
                  const l = lineById.get(id);
                  return l ? (
                    <p key={id} className="text-ink">
                      <span className="tabular-nums text-ink-muted">{formatDate(l.date)}</span> · {l.description} ·{' '}
                      <span className="tabular-nums">{formatMoney(l.amount, currency)}</span>
                    </p>
                  ) : null;
                })}
              </div>
              <div className="space-y-0.5 text-sm">
                {s.journalEntryIds.map((id) => {
                  const m = entryById.get(id);
                  return m ? (
                    <p key={id} className="text-ink">
                      <span className="font-mono text-xs">{m.entryNumber}</span> · {m.description} ·{' '}
                      <span className="tabular-nums">{formatMoney(m.amount, base)}</span>
                    </p>
                  ) : null;
                })}
                <p className="text-xs text-ink-subtle">{s.reason}</p>
              </div>
              <div className="flex items-start gap-2">
                <Badge tone={s.certain ? 'success' : 'neutral'}>{s.certain ? 'Certain' : KIND_LABEL[s.kind]}</Badge>
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={accept.isPending && accept.variables?.lineIds.join(',') === s.lineIds.join(',')}
                    onClick={() => accept.mutate({ lineIds: s.lineIds, journalEntryIds: s.journalEntryIds })}
                  >
                    <Check className="size-4" />
                    Accept
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Matching several at once, by hand: tick the statement lines and the
 * ledger entries that are the same money. In base currency the totals have
 * to agree before it can be saved, as the API will insist anyway.
 */
export function GroupMatchDialog({
  startLine,
  lines,
  movements,
  comparable,
  currency,
  base,
  onClose,
}: {
  startLine: BankStatementLineDto;
  lines: BankStatementLineDto[];
  movements: LedgerMovementDto[];
  comparable: boolean;
  currency: string;
  base: string | undefined;
  onClose: () => void;
}) {
  const create = useCreateBankMatch();
  const [pickedLines, setPickedLines] = useState<Set<string>>(() => new Set([startLine.id]));
  const [pickedEntries, setPickedEntries] = useState<Set<string>>(() => new Set());

  // Same direction first, then nearest in date: what a deposit is likely made of.
  const openLines = useMemo(
    () =>
      lines
        .filter((l) => l.status === 'UNMATCHED')
        .sort(byRelevance(startLine, (l) => l.amount, (l) => l.date)),
    [lines, startLine],
  );
  const entries = useMemo(
    () => [...movements].sort(byRelevance(startLine, (m) => m.amount, (m) => m.entryDate)),
    [movements, startLine],
  );

  const lineTotal = openLines.filter((l) => pickedLines.has(l.id)).reduce((s, l) => s + cents(l.amount), 0);
  const entryTotal = entries.filter((m) => pickedEntries.has(m.journalEntryId)).reduce((s, m) => s + cents(m.amount), 0);
  const difference = lineTotal - entryTotal;
  const ready = pickedLines.size > 0 && pickedEntries.size > 0 && (!comparable || difference === 0);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Match several"
      description="Tick the statement lines and the ledger entries that are the same money."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { lineIds: [...pickedLines], journalEntryIds: [...pickedEntries] },
                { onSuccess: onClose },
              )
            }
          >
            Match {pickedLines.size} line(s) to {pickedEntries.size} entr{pickedEntries.size === 1 ? 'y' : 'ies'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-ink-subtle">Statement lines</legend>
          <div className="max-h-72 space-y-1 overflow-auto">
            {openLines.map((l) => (
              <label key={l.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-muted">
                <input
                  type="checkbox"
                  checked={pickedLines.has(l.id)}
                  onChange={() => setPickedLines((s) => toggle(s, l.id))}
                />
                <span className="tabular-nums text-ink-muted">{formatDate(l.date)}</span>
                <span className="min-w-0 flex-1 truncate">{l.description}</span>
                <span className="tabular-nums">{formatMoney(l.amount, currency)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-ink-subtle">Ledger entries</legend>
          <div className="max-h-72 space-y-1 overflow-auto">
            {entries.length === 0 && <p className="text-sm text-ink-subtle">Nothing unreconciled in the ledger.</p>}
            {entries.map((m) => (
              <label
                key={m.journalEntryId}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  aria-label={`${m.entryNumber} ${m.description}`}
                  checked={pickedEntries.has(m.journalEntryId)}
                  onChange={() => setPickedEntries((s) => toggle(s, m.journalEntryId))}
                />
                <span className="font-mono text-xs">{m.entryNumber}</span>
                <span className="min-w-0 flex-1 truncate">{m.description}</span>
                <span className="tabular-nums">{formatMoney(m.amount, base)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 rounded bg-surface-sunk p-3 text-sm">
        <div>
          <dt className="text-xs text-ink-subtle">Lines</dt>
          <dd className="tabular-nums">{formatMoney(lineTotal / 100, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Entries</dt>
          <dd className="tabular-nums">{formatMoney(entryTotal / 100, base)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Difference</dt>
          <dd
            data-testid="group-difference"
            className={`tabular-nums ${comparable && difference !== 0 ? 'text-warning' : 'text-success'}`}
          >
            {comparable ? formatMoney(difference / 100, base) : '—'}
          </dd>
        </div>
      </dl>
      {!comparable && (
        <p className="mt-2 text-xs text-ink-subtle">
          This account is not in {base}, so the totals cannot be compared. Check them yourself.
        </p>
      )}
    </Dialog>
  );
}
