import { z } from 'zod';
import { isIsoDate } from '../tax/uae';

const isoDay = z
  .string()
  .trim()
  .refine(isIsoDate, 'Expected a date as YYYY-MM-DD');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const cents = (n: number) => Math.round(n * 100);
const money = z.coerce.number().finite().min(0).max(1_000_000_000_000);

/* ---------------- period lock ---------------- */

export const periodLockSchema = z.object({
  lockedThrough: isoDay.nullable(),
});
export type PeriodLockPayload = z.output<typeof periodLockSchema>;

/* ---------------- manual journals ---------------- */

export const manualJournalLineSchema = z
  .object({
    ledgerAccountId: z.string().uuid('Choose an account'),
    debit: money.default(0),
    credit: money.default(0),
    description: optionalText(255),
  })
  .refine((l) => (cents(l.debit) > 0) !== (cents(l.credit) > 0), {
    message: 'Each line is either a debit or a credit',
    path: ['debit'],
  });

export const manualJournalSchema = z
  .object({
    entryDate: isoDay,
    memo: z.string().trim().min(1, 'Say what the journal is for').max(500),
    lines: z.array(manualJournalLineSchema).min(2, 'A journal needs at least two lines').max(200),
  })
  .refine(
    (j) => j.lines.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0) === 0,
    { message: 'Debits and credits must be equal', path: ['lines'] },
  );
export type ManualJournalInput = z.input<typeof manualJournalSchema>;
export type ManualJournalPayload = z.output<typeof manualJournalSchema>;

export const reverseJournalSchema = z.object({
  entryDate: isoDay.optional(),
  memo: optionalText(500),
});
export type ReverseJournalSchemaPayload = z.output<typeof reverseJournalSchema>;

export const journalListQuerySchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  referenceType: z.string().trim().max(40).optional(),
  ledgerAccountId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type JournalListQuery = z.output<typeof journalListQuerySchema>;

/* ---------------- chart of accounts ---------------- */

const accountCode = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/, 'Codes are up to 20 letters, digits, dots or dashes');

export const createLedgerAccountSchema = z.object({
  code: accountCode,
  name: z.string().trim().min(1, 'Name the account').max(120),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullish().transform((v) => v ?? null),
  description: optionalText(500),
});
export type CreateLedgerAccountSchemaPayload = z.output<typeof createLedgerAccountSchema>;

export const updateLedgerAccountSchema = z
  .object({
    code: accountCode.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.string().uuid().nullable().optional(),
    description: optionalText(500).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdateLedgerAccountSchemaPayload = z.output<typeof updateLedgerAccountSchema>;

/* ---------------- bank reconciliation ---------------- */

export const statementLineSchema = z.object({
  date: isoDay,
  description: z.string().trim().min(1).max(255),
  amount: z.coerce
    .number()
    .finite()
    .refine((n) => cents(n) !== 0, 'A statement line needs an amount'),
  reference: optionalText(100),
});

export const importStatementSchema = z.object({
  financeAccountId: z.string().uuid(),
  lines: z.array(statementLineSchema).min(1, 'The statement has no lines').max(5000),
});
export type ImportStatementSchemaPayload = z.output<typeof importStatementSchema>;

export const matchStatementLineSchema = z.object({
  journalEntryId: z.string().uuid(),
});

export const postStatementLineSchema = z.object({
  ledgerAccountId: z.string().uuid('Choose the account to book it to'),
  description: optionalText(255),
});
export type PostStatementLineSchemaPayload = z.output<typeof postStatementLineSchema>;
