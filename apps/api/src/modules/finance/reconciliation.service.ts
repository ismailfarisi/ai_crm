import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type {
  BankStatementLineDto,
  BankStatementLineStatus,
  ImportStatementResult,
  ImportStatementSchemaPayload,
  LedgerMovementDto,
  PostStatementLineSchemaPayload,
  ReconciliationDto,
} from '@saas/shared';
import { BankStatementLine } from './entities/bank-statement-line.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { BooksService } from './books.service';
import { baseCurrencyFor } from './fx';
import { LedgerService } from './ledger.service';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

/**
 * Bank reconciliation: statement lines imported from the bank, matched one to
 * one against journal entries that moved the account's ledger account.
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
    const [rows, movements] = await Promise.all([
      this.lines.find({
        where: { tenantId, financeAccountId },
        order: { statementDate: 'DESC', createdAt: 'DESC' },
      }),
      this.movements(tenantId, ledgerAccountId),
    ]);

    const numbers = new Map(movements.map((m) => [m.journalEntryId, m.entryNumber]));
    const matched = new Set(rows.map((r) => r.journalEntryId).filter(Boolean));
    const counts: Record<BankStatementLineStatus, number> = {
      UNMATCHED: 0,
      MATCHED: 0,
      EXCLUDED: 0,
    };
    for (const row of rows) counts[row.status]++;

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
      unreconciledLedger: movements.filter((m) => !matched.has(m.journalEntryId)),
      lines: rows.map((r) => toDto(r, numbers)),
      counts,
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
    await this.account(this.dataSource.manager, tenantId, payload.financeAccountId);
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

  async match(
    tenantId: string,
    actorId: string,
    lineId: string,
    journalEntryId: string,
    outer?: EntityManager,
  ): Promise<BankStatementLineDto> {
    const run = async (manager: EntityManager) => {
      const line = await this.line(manager, tenantId, lineId);
      if (line.status !== 'UNMATCHED')
        throw new ConflictException(
          `That line is ${line.status.toLowerCase()}; unmatch it first.`,
        );
      const { ledgerAccountId, comparable } = await this.account(
        manager,
        tenantId,
        line.financeAccountId,
      );
      const entry = await manager
        .getRepository(JournalEntry)
        .findOne({ where: { id: journalEntryId, tenantId } });
      if (!entry) throw new NotFoundException('Journal entry not found');

      const net = netOn(entry, ledgerAccountId);
      if (net === null)
        throw new BadRequestException(
          `${entry.entryNumber} does not move this account.`,
        );
      if (comparable && cents(net) !== cents(Number(line.amount)))
        throw new BadRequestException(
          `The amounts differ: the statement says ${Number(line.amount).toFixed(2)}, ${entry.entryNumber} moved the account by ${net.toFixed(2)}.`,
        );

      const taken = await manager.getRepository(BankStatementLine).findOne({
        where: {
          tenantId,
          financeAccountId: line.financeAccountId,
          journalEntryId,
        },
      });
      if (taken)
        throw new ConflictException(
          `${entry.entryNumber} is already matched to the line of ${taken.statementDate} "${taken.description}".`,
        );

      line.status = 'MATCHED';
      line.journalEntryId = entry.id;
      line.matchedAt = new Date();
      line.matchedById = actorId;
      await manager.getRepository(BankStatementLine).save(line);
      return toDto(line, new Map([[entry.id, entry.entryNumber]]));
    };
    return outer ? run(outer) : this.dataSource.transaction(run);
  }

  async setStatus(
    tenantId: string,
    lineId: string,
    status: 'UNMATCHED' | 'EXCLUDED',
  ): Promise<BankStatementLineDto> {
    return this.dataSource.transaction(async (manager) => {
      const line = await this.line(manager, tenantId, lineId);
      if (status === 'EXCLUDED' && line.status === 'MATCHED')
        throw new ConflictException('Unmatch the line before excluding it.');
      line.status = status;
      line.journalEntryId = null;
      line.matchedAt = null;
      line.matchedById = null;
      await manager.getRepository(BankStatementLine).save(line);
      return toDto(line, new Map());
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
        throw new ConflictException(`That line is ${line.status.toLowerCase()}.`);
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
      return this.match(tenantId, actorId, line.id, entry.id, manager);
    });
  }

  /* ------------------------------------------------------------------ */

  private async account(
    manager: EntityManager,
    tenantId: string,
    financeAccountId: string,
  ): Promise<{ account: FinanceAccount; ledgerAccountId: string; comparable: boolean }> {
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
    const line = await manager
      .getRepository(BankStatementLine)
      .findOne({ where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
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
      const line = entry.lines.find((l) => l.ledgerAccountId === ledgerAccountId);
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
  const lines = (entry.lines ?? []).filter((l) => l.ledgerAccountId === ledgerAccountId);
  if (!lines.length) return null;
  return (
    lines.reduce(
      (s, l) => s + cents(Number(l.debit) || 0) - cents(Number(l.credit) || 0),
      0,
    ) / 100
  );
}

function toDto(
  row: BankStatementLine,
  numbers: Map<string, string>,
): BankStatementLineDto {
  return {
    id: row.id,
    financeAccountId: row.financeAccountId,
    date: row.statementDate,
    description: row.description,
    amount: Number(row.amount),
    reference: row.reference,
    status: row.status,
    journalEntryId: row.journalEntryId,
    journalEntryNumber: row.journalEntryId
      ? (numbers.get(row.journalEntryId) ?? null)
      : null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}
