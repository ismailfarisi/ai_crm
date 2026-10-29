/**
 * Keeping the books: manual journals, the period lock, the chart of accounts
 * a tenant edits, and bank reconciliation.
 *
 * Dates here are plain `YYYY-MM-DD` strings. A lock date and a statement date
 * are calendar facts; carrying them as `Date` lets a timezone move the edge.
 */

import type { LedgerAccountType, LedgerRole } from './ledger';
import type { ReconciliationSuggestion } from './reconciliation-suggest';

/* ------------------------------------------------------------------ *
 * Period lock
 * ------------------------------------------------------------------ */

export interface PeriodLockDto {
  /** Nothing dated on or before this day can post. Null when the books are open. */
  lockedThrough: string | null;
  lockedAt: string | null;
  lockedById: string | null;
}

/** The SQLSTATE the period-lock trigger raises, mapped to a 409 by the API. */
export const PERIOD_LOCKED_SQLSTATE = 'KB001';

/* ------------------------------------------------------------------ *
 * Manual journals
 * ------------------------------------------------------------------ */

/**
 * Accounts a manual journal may not touch, because a sub-ledger owns them.
 *
 * Receivables, payables and stock are each the sum of documents: an aging
 * report or a stock valuation reconciles to the account. A journal straight
 * to one of them makes that reconciliation fail forever, with nothing on any
 * document to explain it. Corrections go through the document — a credit
 * note, a bill, a stock adjustment.
 */
export const SUBLEDGER_CONTROLLED_ROLES: readonly LedgerRole[] = [
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'INVENTORY',
  'GRNI',
  'WIP',
];

export interface ManualJournalLinePayload {
  ledgerAccountId: string;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface CreateManualJournalPayload {
  entryDate: string;
  memo: string;
  lines: ManualJournalLinePayload[];
}

export interface ReverseJournalPayload {
  /** Defaults to today. A reversal is a new posting, so it respects the lock. */
  entryDate?: string;
  memo?: string;
}

export interface JournalEntryListParams {
  from?: string;
  to?: string;
  referenceType?: string;
  ledgerAccountId?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ *
 * Chart of accounts
 * ------------------------------------------------------------------ */

export interface CreateLedgerAccountPayload {
  code: string;
  name: string;
  type: LedgerAccountType;
  parentId?: string | null;
  description?: string | null;
}

export interface UpdateLedgerAccountPayload {
  code?: string;
  name?: string;
  parentId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

/* ------------------------------------------------------------------ *
 * Bank reconciliation
 * ------------------------------------------------------------------ */

export type BankStatementLineStatus = 'UNMATCHED' | 'MATCHED' | 'EXCLUDED';

export interface BankStatementLineInput {
  date: string;
  description: string;
  /** Money in is positive, money out negative, in the account's currency. */
  amount: number;
  reference?: string | null;
}

export interface ImportStatementPayload {
  financeAccountId: string;
  lines: BankStatementLineInput[];
}

export interface ImportStatementResult {
  imported: number;
  /** Lines already imported (same date, amount, description and reference). */
  skipped: number;
}

export interface BankStatementLineDto {
  id: string;
  financeAccountId: string;
  date: string;
  description: string;
  amount: number;
  reference: string | null;
  status: BankStatementLineStatus;
  /** The match this line belongs to. Unmatching any line of it unmatches all of it. */
  matchId: string | null;
  /** The ledger entries the match covers. Several for a deposit of several receipts. */
  matchedEntries: { journalEntryId: string; entryNumber: string }[];
  /** Statement lines in the match, this one included. More than one for a payout split across lines. */
  matchedLineCount: number;
  createdAt: string;
}

/** A movement on the account's ledger account that no statement line claims yet. */
export interface LedgerMovementDto {
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  referenceType: string;
  description: string;
  /** Net debit minus credit on the cash account's ledger account: positive is money in. */
  amount: number;
}

export interface ReconciliationDto {
  financeAccountId: string;
  /** The bank account's own ledger account; a line cannot be booked against it. */
  ledgerAccountId: string;
  accountName: string;
  currency: string;
  /** False when the account is not in base currency: amounts cannot be compared exactly. */
  amountsComparable: boolean;
  /** Sum of every statement line imported. */
  statementBalance: number;
  /** The account's ledger balance, in base currency. */
  ledgerBalance: number;
  /** Ledger movements not yet matched to any statement line. */
  unreconciledLedger: LedgerMovementDto[];
  lines: BankStatementLineDto[];
  counts: Record<BankStatementLineStatus, number>;
  /**
   * Proposed matches for the open lines, best first. Empty when amounts
   * cannot be compared (an account not in base currency).
   */
  suggestions: ReconciliationSuggestion[];
}

export interface MatchStatementLinePayload {
  journalEntryId: string;
}

/**
 * Any number of open statement lines against any number of unreconciled
 * entries. The totals must agree when the account is in base currency.
 */
export interface CreateBankMatchPayload {
  lineIds: string[];
  journalEntryIds: string[];
}

export interface AutoMatchResult {
  /** Matches made: every suggestion that was certain. */
  matched: number;
}

/** Books an unmatched line (bank charges, interest) and matches it in one step. */
export interface PostStatementLinePayload {
  ledgerAccountId: string;
  description?: string | null;
}

/** Ledger movements whose amount and date sit closest to a statement line, best first. */
export function suggestMatches(
  line: Pick<BankStatementLineDto, 'amount' | 'date'>,
  movements: LedgerMovementDto[],
  windowDays = 10,
): LedgerMovementDto[] {
  const cents = (n: number) => Math.round(n * 100);
  const dayMs = 86_400_000;
  const at = Date.parse(`${line.date}T00:00:00Z`);
  return movements
    .filter((m) => cents(m.amount) === cents(line.amount))
    .map((m) => ({ m, gap: Math.abs(Date.parse(`${m.entryDate.slice(0, 10)}T00:00:00Z`) - at) / dayMs }))
    .filter(({ gap }) => gap <= windowDays)
    .sort((a, b) => a.gap - b.gap)
    .map(({ m }) => m);
}

/* ------------------------------------------------------------------ *
 * Statement CSV
 * ------------------------------------------------------------------ */

export interface ParsedStatement {
  lines: BankStatementLineInput[];
  /** Row numbers (1-based, header excluded) that could not be read, with why. */
  errors: { row: number; message: string }[];
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas or semicolons. */
function splitCsvRow(row: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/** `1,234.50`, `(45.00)`, `-45`, `AED 12.00` → number; null when it is not one. */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[A-Za-z\s]/g, '').replace(/,/g, '');
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/^[-+]?\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round((negative ? -value : value) * 100) / 100;
}

/**
 * `2026-10-05`, `05/10/2026` or `05-10-2026` (day first, as UAE banks print
 * it), `05 Oct 2026` → `2026-10-05`. Null when unreadable.
 */
export function parseStatementDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/.exec(text);
  if (m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mo = months.indexOf(m[2].toLowerCase()) + 1;
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const d = Number(m[1]);
    return mo > 0 && valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'value date', 'posting date', 'txn date'],
  description: ['description', 'details', 'narrative', 'narration', 'particulars', 'memo', 'transaction details'],
  amount: ['amount', 'value', 'transaction amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'dr'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'cr'],
  reference: ['reference', 'ref', 'cheque no', 'cheque number', 'transaction id'],
} as const;

/**
 * Reads a bank's CSV export.
 *
 * Columns are found by header name, so the order a bank chooses does not
 * matter: a date, a description, and either one signed amount or separate
 * debit and credit columns. Rows that cannot be read are reported rather than
 * dropped, so a statement never imports short without anyone noticing.
 */
export function parseStatementCsv(text: string): ParsedStatement {
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((r) => r.trim() !== '');
  if (rows.length === 0) return { lines: [], errors: [{ row: 0, message: 'The file is empty' }] };

  const delimiter = (rows[0].match(/;/g)?.length ?? 0) > (rows[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitCsvRow(rows[0], delimiter).map((h) => h.toLowerCase().replace(/[^a-z ]/g, '').trim());
  const find = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const col = {
    date: find(HEADER_ALIASES.date),
    description: find(HEADER_ALIASES.description),
    amount: find(HEADER_ALIASES.amount),
    debit: find(HEADER_ALIASES.debit),
    credit: find(HEADER_ALIASES.credit),
    reference: find(HEADER_ALIASES.reference),
  };

  if (col.date < 0 || col.description < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) {
    return {
      lines: [],
      errors: [
        {
          row: 0,
          message:
            'Could not find the columns. The first row must name a Date, a Description, and either an Amount or Debit and Credit columns.',
        },
      ],
    };
  }

  const lines: BankStatementLineInput[] = [];
  const errors: ParsedStatement['errors'] = [];
  rows.slice(1).forEach((row, i) => {
    const cells = splitCsvRow(row, delimiter);
    const rowNumber = i + 1;
    const date = parseStatementDate(cells[col.date]);
    if (!date) {
      errors.push({ row: rowNumber, message: `Unreadable date "${cells[col.date] ?? ''}"` });
      return;
    }
    let amount: number | null;
    if (col.amount >= 0) {
      amount = parseStatementAmount(cells[col.amount]);
    } else {
      const debit = col.debit >= 0 ? (parseStatementAmount(cells[col.debit]) ?? 0) : 0;
      const credit = col.credit >= 0 ? (parseStatementAmount(cells[col.credit]) ?? 0) : 0;
      amount = Math.round((credit - Math.abs(debit)) * 100) / 100;
    }
    if (amount == null || amount === 0) {
      errors.push({ row: rowNumber, message: 'No amount' });
      return;
    }
    const description = (cells[col.description] ?? '').slice(0, 255) || '(no description)';
    const reference = col.reference >= 0 ? cells[col.reference]?.slice(0, 100) || null : null;
    lines.push({ date, description, amount, reference });
  });
  return { lines, errors };
}
