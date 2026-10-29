import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  suggestReconciliation,
  type AutoMatchResult,
  type BankStatementLineDto,
  type BankStatementLineStatus,
  type ImportStatementResult,
  type ImportStatementSchemaPayload,
  type LedgerMovementDto,
  type PostStatementLineSchemaPayload,
  type ReconciliationDto,
} from '@saas/shared';
import { BankMatch, BankMatchEntry } from './entities/bank-match.entity';
import { BankStatementLine } from './entities/bank-statement-line.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { BooksService } from './books.service';
import { baseCurrencyFor } from './fx';
import { LedgerService } from './ledger.service';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const money = (c: number) => (c / 100).toFixed(2);

const ENTRY_TAKEN = 'uq_bank_match_entries_entry';

type MatchedEntries = Map<
  string,
  { journalEntryId: string; entryNumber: string }[]
>;

/**
 * Bank reconciliation: statement lines imported from the bank, matched
 * against journal entries that moved the account's ledger account.
 *
 * A match is a group: any number of lines against any number of entries,
 * whose totals agree. One of each is the usual case; a deposit of several
 * receipts and a payroll paid out per person are the reasons it is a group.
 *
 * A line the books have no entry for (bank charges, interest) is booked and
 * matched in one step, through a manual journal. The ledger side is always
 * in base currency, so for an account held in another currency the amounts
 * cannot be compared exactly and matching relies on the person doing it.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(BankStatementLine)
    private readonly lines: Repository<BankStatementLine>,
    @InjectRepository(FinanceAccount)
    private readonly financeAccounts: Repository<FinanceAccount>,
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    private readonly ledger: LedgerService,
    private readonly books: BooksService,
    private readonly dataSource: DataSource,
  ) {}

  async reconciliation(
    tenantId: string,
    financeAccountId: string,
  ): Promise<ReconciliationDto> {
    const { account, ledgerAccountId, comparable } = await this.account(
      this.dataSource.manager,
      tenantId,
      financeAccountId,
    );
    const [rows, movements, matchEntries] = await Promise.all([
      this.lines.find({
        where: { tenantId, financeAccountId },
        order: { statementDate: 'DESC', createdAt: 'DESC' },
      }),
      this.movements(tenantId, ledgerAccountId),
      this.dataSource.manager
        .getRepository(BankMatchEntry)
        .find({ where: { tenantId, financeAccountId } }),
    ]);

    const numbers = await this.entryNumbers(
      tenantId,
      matchEntries.map((e) => e.journalEntryId),
      movements,
    );
    const byMatch: MatchedEntries = new Map();
    for (const e of matchEntries) {
      const list = byMatch.get(e.matchId) ?? [];
      list.push({
        journalEntryId: e.journalEntryId,
        entryNumber: numbers.get(e.journalEntryId) ?? '—',
      });
      byMatch.set(e.matchId, list);
    }
    const lineCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.matchId)
        lineCounts.set(r.matchId, (lineCounts.get(r.matchId) ?? 0) + 1);
    }

    const reconciled = new Set(matchEntries.map((e) => e.journalEntryId));
    const unreconciledLedger = movements.filter(
      (m) => !reconciled.has(m.journalEntryId),
    );
    const counts: Record<BankStatementLineStatus, number> = {
      UNMATCHED: 0,
      MATCHED: 0,
      EXCLUDED: 0,
    };
    for (const row of rows) counts[row.status]++;
    const lines = rows.map((r) => toDto(r, byMatch, lineCounts));

    return {
      financeAccountId,
      ledgerAccountId,
      accountName: account.name,
      currency: account.currency,
      amountsComparable: comparable,
      statementBalance:
        rows
          .filter((r) => r.status !== 'EXCLUDED')
          .reduce((s, r) => s + cents(Number(r.amount)), 0) / 100,
      ledgerBalance: movements.reduce((s, m) => s + cents(m.amount), 0) / 100,
      unreconciledLedger,
      lines,
      counts,
      // Suggestions compare amounts, which an account in another currency
      // cannot do against a base-currency ledger.
      suggestions: comparable
        ? suggestReconciliation(
            lines.filter((l) => l.status === 'UNMATCHED'),
            unreconciledLedger,
          )
        : [],
    };
  }

  /**
   * Adds a statement's lines, skipping any already imported.
   *
   * A line's fingerprint is its date, amount, description and reference plus
   * how many identical lines came before it in the file, so two genuine
   * AED 50 charges on one day both import, and re-importing the same file —
   * or one that overlaps it — adds nothing twice.
   */
  async import(
    tenantId: string,
    payload: ImportStatementSchemaPayload,
  ): Promise<ImportStatementResult> {
    await this.account(
      this.dataSource.manager,
      tenantId,
      payload.financeAccountId,
    );
    const seen = new Map<string, number>();
    const rows = payload.lines.map((line) => {
      const key = [
        line.date,
        (cents(line.amount) / 100).toFixed(2),
        line.description.trim().toLowerCase(),
        (line.reference ?? '').trim().toLowerCase(),
      ].join('|');
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      return {
        tenantId,
        financeAccountId: payload.financeAccountId,
        statementDate: line.date,
        description: line.description,
        amount: cents(line.amount) / 100,
        reference: line.reference,
        fingerprint: createHash('sha256').update(`${key}#${nth}`).digest('hex'),
        status: 'UNMATCHED' as const,
      };
    });

    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const result = await this.lines
        .createQueryBuilder()
        .insert()
        .into(BankStatementLine)
        .values(rows.slice(i, i + 500))
        .orIgnore()
        .returning(['id'])
        .execute();
      imported += result.raw.length;
    }
    return { imported, skipped: rows.length - imported };
  }

  /**
   * Matches statement lines to journal entries as one group.
   *
   * Every line must be open and on the same account; every entry must move
   * that account and not already be reconciled. In base currency the totals
   * must agree to the cent. The unique index on (account, entry) is the
   * final word on "already reconciled", so two people matching the same
   * entry at once cannot both succeed.
   */
  async match(
    tenantId: string,
    actorId: string,
    lineIds: string[],
    journalEntryIds: string[],
    outer?: EntityManager,
  ): Promise<BankStatementLineDto[]> {
    if (!lineIds.length || !journalEntryIds.length) {
      throw new BadRequestException(
        'Choose at least one statement line and one ledger entry.',
      );
    }
    const run = async (manager: EntityManager) => {
      const lines = await manager.getRepository(BankStatementLine).find({
        where: { id: In(lineIds), tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (lines.length !== new Set(lineIds).size) {
        throw new NotFoundException('Statement line not found');
      }
      const accountId = lines[0].financeAccountId;
      if (lines.some((l) => l.financeAccountId !== accountId)) {
        throw new BadRequestException(
          'The lines belong to different accounts.',
        );
      }
      const closed = lines.find((l) => l.status !== 'UNMATCHED');
      if (closed) {
        throw new ConflictException(
          `The line of ${closed.statementDate} "${closed.description}" is ${closed.status.toLowerCase()}; unmatch it first.`,
        );
      }
      const { ledgerAccountId, comparable } = await this.account(
        manager,
        tenantId,
        accountId,
      );

      const entries = await manager
        .getRepository(JournalEntry)
        .find({ where: { id: In(journalEntryIds), tenantId } });
      if (entries.length !== new Set(journalEntryIds).size) {
        throw new NotFoundException('Journal entry not found');
      }
      let entryCents = 0;
      for (const entry of entries) {
        const net = netOn(entry, ledgerAccountId);
        if (net === null || cents(net) === 0) {
          throw new BadRequestException(
            `${entry.entryNumber} does not move this account.`,
          );
        }
        entryCents += cents(net);
      }

      const taken = await manager.getRepository(BankMatchEntry).find({
        where: {
          tenantId,
          financeAccountId: accountId,
          journalEntryId: In(journalEntryIds),
        },
      });
      if (taken.length) {
        const names = entries
          .filter((e) => taken.some((t) => t.journalEntryId === e.id))
          .map((e) => e.entryNumber);
        throw new ConflictException(
          `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already reconciled.`,
        );
      }

      const lineCents = lines.reduce((s, l) => s + cents(Number(l.amount)), 0);
      if (comparable && lineCents !== entryCents) {
        throw new BadRequestException(
          `The totals differ: the statement line${lines.length === 1 ? ' says' : 's add up to'} ${money(lineCents)}, ` +
            `the entr${entries.length === 1 ? 'y moved' : 'ies moved'} the account by ${money(entryCents)}.`,
        );
      }
      if (!comparable && Math.sign(lineCents) !== Math.sign(entryCents)) {
        throw new BadRequestException(
          'The statement shows money going one way and the ledger the other.',
        );
      }

      const now = new Date();
      const match = await manager.getRepository(BankMatch).save(
        manager.getRepository(BankMatch).create({
          tenantId,
          financeAccountId: accountId,
          matchedAt: now,
          matchedById: actorId,
        }),
      );
      try {
        await manager.getRepository(BankMatchEntry).insert(
          entries.map((e) => ({
            tenantId,
            matchId: match.id,
            financeAccountId: accountId,
            journalEntryId: e.id,
          })),
        );
      } catch (err) {
        if (isUniqueViolation(err, ENTRY_TAKEN)) {
          throw new ConflictException(
            'One of those entries was reconciled a moment ago. Reload and try again.',
          );
        }
        throw err;
      }
      for (const line of lines) {
        line.status = 'MATCHED';
        line.matchId = match.id;
        line.matchedAt = now;
        line.matchedById = actorId;
      }
      await manager.getRepository(BankStatementLine).save(lines);

      const matched: MatchedEntries = new Map([
        [
          match.id,
          entries.map((e) => ({
            journalEntryId: e.id,
            entryNumber: e.entryNumber,
          })),
        ],
      ]);
      const count = new Map([[match.id, lines.length]]);
      return lines.map((l) => toDto(l, matched, count));
    };
    return outer ? run(outer) : this.dataSource.transaction(run);
  }

  /**
   * Applies every suggestion that is certain — the only pairing either side
   * could make — and nothing else. Each is its own transaction, so one that
   * someone else matched meanwhile is skipped rather than undoing the rest.
   */
  async autoMatch(
    tenantId: string,
    actorId: string,
    financeAccountId: string,
  ): Promise<AutoMatchResult> {
    const { suggestions } = await this.reconciliation(
      tenantId,
      financeAccountId,
    );
    let matched = 0;
    for (const s of suggestions.filter((x) => x.certain)) {
      try {
        await this.match(tenantId, actorId, s.lineIds, s.journalEntryIds);
        matched++;
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
      }
    }
    return { matched };
  }

  /**
   * Reopens a line. A matched line takes its whole match with it — every
   * line and entry in the group is freed — since half a match is not one.
   */
  async setStatus(
    tenantId: string,
    lineId: string,
    status: 'UNMATCHED' | 'EXCLUDED',
  ): Promise<BankStatementLineDto> {
    return this.dataSource.transaction(async (manager) => {
      const line = await this.line(manager, tenantId, lineId);
      if (status === 'EXCLUDED' && line.status === 'MATCHED')
        throw new ConflictException('Unmatch the line before excluding it.');

      if (line.matchId) {
        const matchId = line.matchId;
        await manager
          .getRepository(BankStatementLine)
          .createQueryBuilder()
          .update()
          .set({
            status: 'UNMATCHED',
            matchId: null,
            matchedAt: null,
            matchedById: null,
          })
          .where('tenant_id = :tenantId AND match_id = :matchId', {
            tenantId,
            matchId,
          })
          .execute();
        // Entries go with it (ON DELETE CASCADE).
        await manager
          .getRepository(BankMatch)
          .delete({ id: matchId, tenantId });
      }

      line.status = status;
      line.matchId = null;
      line.matchedAt = null;
      line.matchedById = null;
      await manager.getRepository(BankStatementLine).save(line);
      return toDto(line, new Map(), new Map());
    });
  }

  /**
   * Books a line the ledger has no entry for and matches it: money out
   * debits the chosen account, money in credits it. Dated on the statement
   * day, so it respects the period lock like any journal.
   */
  async postAndMatch(
    tenantId: string,
    actorId: string,
    lineId: string,
    payload: PostStatementLineSchemaPayload,
  ): Promise<BankStatementLineDto> {
    return this.dataSource.transaction(async (manager) => {
      const line = await this.line(manager, tenantId, lineId);
      if (line.status !== 'UNMATCHED')
        throw new ConflictException(
          `That line is ${line.status.toLowerCase()}.`,
        );
      const { ledgerAccountId } = await this.account(
        manager,
        tenantId,
        line.financeAccountId,
      );
      if (payload.ledgerAccountId === ledgerAccountId)
        throw new BadRequestException(
          'Book the line to the account the money came from or went to, not to the bank account itself.',
        );
      const amount = Math.abs(Number(line.amount));
      const moneyIn = Number(line.amount) > 0;
      const description = payload.description ?? line.description;
      const entry = await this.books.postManual(
        tenantId,
        actorId,
        {
          entryDate: line.statementDate,
          memo: `Bank statement: ${description}`,
          lines: [
            {
              ledgerAccountId,
              debit: moneyIn ? amount : 0,
              credit: moneyIn ? 0 : amount,
              description,
            },
            {
              ledgerAccountId: payload.ledgerAccountId,
              debit: moneyIn ? 0 : amount,
              credit: moneyIn ? amount : 0,
              description,
            },
          ],
        },
        manager,
      );
      const [matched] = await this.match(
        tenantId,
        actorId,
        [line.id],
        [entry.id],
        manager,
      );
      return matched;
    });
  }

  /* ------------------------------------------------------------------ */

  private async account(
    manager: EntityManager,
    tenantId: string,
    financeAccountId: string,
  ): Promise<{
    account: FinanceAccount;
    ledgerAccountId: string;
    comparable: boolean;
  }> {
    const account = await manager
      .getRepository(FinanceAccount)
      .findOne({ where: { id: financeAccountId, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    const ledger = await this.ledger.ensureCashLedgerAccount(
      tenantId,
      account,
      manager,
    );
    const base = await baseCurrencyFor(manager, tenantId);
    return {
      account,
      ledgerAccountId: ledger.id,
      comparable: (account.currency ?? base).trim().toUpperCase() === base,
    };
  }

  private async line(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<BankStatementLine> {
    const line = await manager.getRepository(BankStatementLine).findOne({
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
  }

  /** Entry numbers for reconciled entries, mostly from the movements already loaded. */
  private async entryNumbers(
    tenantId: string,
    ids: string[],
    movements: LedgerMovementDto[],
  ): Promise<Map<string, string>> {
    const numbers = new Map(
      movements.map((m) => [m.journalEntryId, m.entryNumber]),
    );
    const missing = [...new Set(ids)].filter((id) => !numbers.has(id));
    if (missing.length) {
      const rows = await this.journal.find({
        where: { id: In(missing), tenantId },
        select: { id: true, entryNumber: true },
      });
      for (const r of rows) numbers.set(r.id, r.entryNumber);
    }
    return numbers;
  }

  /** Every entry that moved this ledger account, newest first, with its net movement. */
  private async movements(
    tenantId: string,
    ledgerAccountId: string,
  ): Promise<LedgerMovementDto[]> {
    const entries = await this.journal
      .createQueryBuilder('e')
      .where('e."tenantId" = :tenantId', { tenantId })
      .andWhere('e."lines" @> :line::jsonb', {
        line: JSON.stringify([{ ledgerAccountId }]),
      })
      .orderBy('e."entryDate"', 'DESC')
      .addOrderBy('e."createdAt"', 'DESC')
      .getMany();
    const out: LedgerMovementDto[] = [];
    for (const entry of entries) {
      const net = netOn(entry, ledgerAccountId);
      if (net === null || cents(net) === 0) continue;
      const line = entry.lines.find(
        (l) => l.ledgerAccountId === ledgerAccountId,
      );
      out.push({
        journalEntryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate.toISOString(),
        referenceType: entry.referenceType,
        description: entry.memo ?? line?.description ?? entry.entryNumber,
        amount: net,
      });
    }
    return out;
  }
}

/** Debit minus credit on one ledger account; null when the entry does not touch it. */
function netOn(entry: JournalEntry, ledgerAccountId: string): number | null {
  const lines = (entry.lines ?? []).filter(
    (l) => l.ledgerAccountId === ledgerAccountId,
  );
  if (!lines.length) return null;
  return (
    lines.reduce(
      (s, l) => s + cents(Number(l.debit) || 0) - cents(Number(l.credit) || 0),
      0,
    ) / 100
  );
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driver = err.driverError as
    { code?: string; constraint?: string } | undefined;
  return driver?.code === '23505' && driver.constraint === constraint;
}

function toDto(
  row: BankStatementLine,
  matched: MatchedEntries,
  lineCounts: Map<string, number>,
): BankStatementLineDto {
  return {
    id: row.id,
    financeAccountId: row.financeAccountId,
    date: row.statementDate,
    description: row.description,
    amount: Number(row.amount),
    reference: row.reference,
    status: row.status,
    matchId: row.matchId,
    matchedEntries: row.matchId ? (matched.get(row.matchId) ?? []) : [],
    matchedLineCount: row.matchId ? (lineCounts.get(row.matchId) ?? 1) : 0,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}
