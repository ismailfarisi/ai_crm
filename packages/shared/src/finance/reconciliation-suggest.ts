import type { BankStatementLineDto, LedgerMovementDto } from './books';

/**
 * Proposed matches between open statement lines and unreconciled ledger
 * entries.
 *
 * Three shapes, because a bank does not see the books' granularity:
 *
 * - one line, one entry — most of a statement;
 * - one line, several entries — a deposit of three cheques, a card
 *   settlement covering several receipts;
 * - several lines, one entry — a payroll run booked once and paid out as
 *   one transfer per person.
 *
 * Only exact amounts are proposed; a difference is a question for a person,
 * not a suggestion. A pairing is `certain` only when it is the only one
 * either side could make, so applying every certain suggestion at once
 * cannot pick the wrong one of two identical payments.
 *
 * Pure, so the API (which applies suggestions) and the screen (which shows
 * them) agree on every one.
 */

export type SuggestionKind = 'ONE_TO_ONE' | 'ONE_LINE_MANY_ENTRIES' | 'MANY_LINES_ONE_ENTRY';

export interface ReconciliationSuggestion {
  kind: SuggestionKind;
  lineIds: string[];
  journalEntryIds: string[];
  /** Mutually unique and close in date: safe to apply without looking. */
  certain: boolean;
  /** 0–1. Orders suggestions; not a probability. */
  score: number;
  /** One sentence for the person deciding. */
  reason: string;
}

export type SuggestionLine = Pick<BankStatementLineDto, 'id' | 'date' | 'amount' | 'description' | 'reference'>;

export interface SuggestOptions {
  /** How far apart, in days, a line and an entry may be dated. */
  windowDays?: number;
  /** Largest group either side of a combination. */
  maxGroup?: number;
}

const DAY_MS = 86_400_000;
/** A one-to-one pairing further apart than this is never called certain. */
const CERTAIN_WITHIN_DAYS = 5;
/** Combination searches look only at this many nearest-dated candidates. */
const POOL_SIZE = 20;

const cents = (n: number) => Math.round(n * 100);
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const gapDays = (a: string, b: string) => Math.abs(dayOf(a) - dayOf(b)) / DAY_MS;

/** Words and numbers worth comparing: references, names, document numbers. */
const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toUpperCase()
      .split(/[^A-Z0-9-]+/)
      .flatMap((t) => [t, ...t.split('-')])
      .filter((t) => t.length >= 3 || /\d{2,}/.test(t)),
  );

/** Shared tokens, weighted towards ones with digits — an invoice number says more than "PAYMENT". */
function textAffinity(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const t of a) {
    if (!b.has(t)) continue;
    score += /\d/.test(t) ? (t.length >= 6 ? 1 : 0.4) : 0.15;
  }
  return Math.min(1, score);
}

const lineText = (l: SuggestionLine) => tokens(`${l.description} ${l.reference ?? ''}`);
const entryText = (m: LedgerMovementDto) => tokens(`${m.description} ${m.entryNumber}`);

/** Every combination of `size` items from `items`, as index lists. */
function* combinations(n: number, size: number, start = 0, picked: number[] = []): Generator<number[]> {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = start; i <= n - (size - picked.length); i++) {
    yield* combinations(n, size, i + 1, [...picked, i]);
  }
}

/**
 * The smallest exact combination of `pool` amounts summing to `target`
 * (all in cents, same sign), preferring fewer items, then closer dates.
 */
function findCombination<T>(
  pool: { item: T; cents: number; gap: number }[],
  target: number,
  maxGroup: number,
): { items: T[]; ambiguous: boolean; gap: number } | null {
  for (let size = 2; size <= Math.min(maxGroup, pool.length); size++) {
    const found: { items: T[]; gap: number }[] = [];
    for (const combo of combinations(pool.length, size)) {
      let sum = 0;
      for (const i of combo) sum += pool[i].cents;
      if (sum !== target) continue;
      found.push({
        items: combo.map((i) => pool[i].item),
        gap: Math.max(...combo.map((i) => pool[i].gap)),
      });
      if (found.length > 5) break;
    }
    if (found.length) {
      found.sort((a, b) => a.gap - b.gap);
      return { items: found[0].items, ambiguous: found.length > 1, gap: found[0].gap };
    }
  }
  return null;
}

export function suggestReconciliation(
  lines: SuggestionLine[],
  movements: LedgerMovementDto[],
  options: SuggestOptions = {},
): ReconciliationSuggestion[] {
  const windowDays = options.windowDays ?? 10;
  const maxGroup = options.maxGroup ?? 4;
  const closeness = (gap: number) => 1 - gap / (windowDays + 1);

  const lineTokens = new Map(lines.map((l) => [l.id, lineText(l)]));
  const entryTokens = new Map(movements.map((m) => [m.journalEntryId, entryText(m)]));

  /* ---- one to one ---- */
  const pairs: { line: SuggestionLine; entry: LedgerMovementDto; gap: number; score: number }[] = [];
  for (const l of lines) {
    for (const m of movements) {
      if (cents(m.amount) !== cents(l.amount)) continue;
      const gap = gapDays(l.date, m.entryDate);
      if (gap > windowDays) continue;
      const text = textAffinity(lineTokens.get(l.id)!, entryTokens.get(m.journalEntryId)!);
      pairs.push({ line: l, entry: m, gap, score: 0.6 * closeness(gap) + 0.4 * text });
    }
  }
  const perLine = new Map<string, number>();
  const perEntry = new Map<string, number>();
  for (const p of pairs) {
    perLine.set(p.line.id, (perLine.get(p.line.id) ?? 0) + 1);
    perEntry.set(p.entry.journalEntryId, (perEntry.get(p.entry.journalEntryId) ?? 0) + 1);
  }
  const isCertain = (p: (typeof pairs)[number]) =>
    perLine.get(p.line.id) === 1 && perEntry.get(p.entry.journalEntryId) === 1 && p.gap <= CERTAIN_WITHIN_DAYS;
  pairs.sort((a, b) => Number(isCertain(b)) - Number(isCertain(a)) || b.score - a.score || a.gap - b.gap);

  const usedLines = new Set<string>();
  const usedEntries = new Set<string>();
  const out: ReconciliationSuggestion[] = [];
  for (const p of pairs) {
    if (usedLines.has(p.line.id) || usedEntries.has(p.entry.journalEntryId)) continue;
    usedLines.add(p.line.id);
    usedEntries.add(p.entry.journalEntryId);
    const certain = isCertain(p);
    out.push({
      kind: 'ONE_TO_ONE',
      lineIds: [p.line.id],
      journalEntryIds: [p.entry.journalEntryId],
      certain,
      score: Math.round((certain ? Math.max(p.score, 0.9) : p.score) * 100) / 100,
      reason: certain
        ? `The only entry for this amount, ${Math.round(p.gap)} day(s) apart.`
        : `Same amount, ${Math.round(p.gap)} day(s) apart; other entries or lines have this amount too.`,
    });
  }

  /* ---- one line, several entries ---- */
  const openLines = () => lines.filter((l) => !usedLines.has(l.id));
  const openEntries = () => movements.filter((m) => !usedEntries.has(m.journalEntryId));

  for (const l of [...openLines()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
    if (usedLines.has(l.id)) continue;
    const target = Math.abs(cents(l.amount));
    const pool = openEntries()
      .filter((m) => Math.sign(m.amount) === Math.sign(l.amount) && Math.abs(cents(m.amount)) < target)
      .map((m) => ({ item: m, cents: Math.abs(cents(m.amount)), gap: gapDays(l.date, m.entryDate) }))
      .filter((c) => c.gap <= windowDays)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, POOL_SIZE);
    const found = findCombination(pool, target, maxGroup);
    if (!found) continue;
    usedLines.add(l.id);
    for (const m of found.items) usedEntries.add(m.journalEntryId);
    out.push({
      kind: 'ONE_LINE_MANY_ENTRIES',
      lineIds: [l.id],
      journalEntryIds: found.items.map((m) => m.journalEntryId),
      certain: false,
      score: Math.round(0.7 * closeness(found.gap) * (found.ambiguous ? 0.6 : 1) * 100) / 100,
      reason: `${found.items.length} entries add up to this line${found.ambiguous ? '; other combinations do too' : ''}.`,
    });
  }

  /* ---- several lines, one entry ---- */
  for (const m of [...openEntries()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
    if (usedEntries.has(m.journalEntryId)) continue;
    const target = Math.abs(cents(m.amount));
    const pool = openLines()
      .filter((l) => Math.sign(l.amount) === Math.sign(m.amount) && Math.abs(cents(l.amount)) < target)
      .map((l) => ({ item: l, cents: Math.abs(cents(l.amount)), gap: gapDays(l.date, m.entryDate) }))
      .filter((c) => c.gap <= windowDays)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, POOL_SIZE);
    const found = findCombination(pool, target, maxGroup);
    if (!found) continue;
    usedEntries.add(m.journalEntryId);
    for (const l of found.items) usedLines.add(l.id);
    out.push({
      kind: 'MANY_LINES_ONE_ENTRY',
      lineIds: found.items.map((l) => l.id),
      journalEntryIds: [m.journalEntryId],
      certain: false,
      score: Math.round(0.7 * closeness(found.gap) * (found.ambiguous ? 0.6 : 1) * 100) / 100,
      reason: `${found.items.length} statement lines add up to ${m.entryNumber}${found.ambiguous ? '; other combinations do too' : ''}.`,
    });
  }

  return out.sort((a, b) => Number(b.certain) - Number(a.certain) || b.score - a.score);
}
