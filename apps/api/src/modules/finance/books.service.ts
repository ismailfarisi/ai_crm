import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  SUBLEDGER_CONTROLLED_ROLES,
  type CreateLedgerAccountSchemaPayload,
  type JournalLineInput,
  type JournalListQuery,
  type ManualJournalPayload,
  type PeriodLockDto,
  type ReverseJournalSchemaPayload,
  type UpdateLedgerAccountSchemaPayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { Organization } from '../organizations/entities/organization.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { baseCurrencyFor } from './fx';
import { LedgerService } from './ledger.service';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const MANUAL_REFERENCE_PREFIX = 'journal:';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const money = (n: number) => cents(n) / 100;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const startOfDayUtc = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The parts of bookkeeping that are an accountant's rather than a document's:
 * manual journals and their reversals, closing a period, and the chart of
 * accounts.
 *
 * The period lock itself is enforced by the `journal_entries_period_lock`
 * trigger; this service only sets it and explains it.
 */
@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /* ------------------------------------------------------------------ *
   * Period lock
   * ------------------------------------------------------------------ */

  async periodLock(tenantId: string): Promise<PeriodLockDto> {
    const org = await this.organizations.findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Organization not found');
    return {
      lockedThrough: org.booksLockedThrough ?? null,
      lockedAt: org.booksLockedAt?.toISOString() ?? null,
      lockedById: org.booksLockedById ?? null,
    };
  }

  /**
   * Locks the books through a day, moves the lock, or (with null) reopens.
   *
   * The lock must be in the past: locking today would refuse every posting
   * the application makes for the rest of the day, payments included.
   */
  async setPeriodLock(
    tenantId: string,
    actorId: string,
    lockedThrough: string | null,
  ): Promise<PeriodLockDto> {
    if (lockedThrough && lockedThrough >= todayUtc()) {
      throw new BadRequestException(
        'The books can only be locked through a day that has already ended.',
      );
    }
    await this.organizations.update(
      { id: tenantId },
      {
        booksLockedThrough: lockedThrough,
        booksLockedAt: lockedThrough ? new Date() : null,
        booksLockedById: lockedThrough ? actorId : null,
      },
    );
    return this.periodLock(tenantId);
  }

  /**
   * The earliest day an automated posting can be dated: `wanted`, or the day
   * after the lock when `wanted` falls inside it.
   *
   * For postings nobody is standing over — an expense approved by a workflow
   * after its month was closed. A person posting gets the trigger's refusal
   * instead, because only they can say which open day is right.
   */
  static async openPostingDate(
    manager: EntityManager,
    tenantId: string,
    wanted: Date,
  ): Promise<Date> {
    const org = await manager.getRepository(Organization).findOne({
      where: { id: tenantId },
      select: { id: true, booksLockedThrough: true },
    });
    const lock = org?.booksLockedThrough;
    if (!lock || wanted.toISOString().slice(0, 10) > lock) return wanted;
    const next = startOfDayUtc(lock);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  /* ------------------------------------------------------------------ *
   * Journal
   * ------------------------------------------------------------------ */

  async listJournals(
    tenantId: string,
    query: JournalListQuery,
  ): Promise<JournalEntry[]> {
    const qb = this.journal
      .createQueryBuilder('e')
      .where('e."tenantId" = :tenantId', { tenantId })
      .orderBy('e."entryDate"', 'DESC')
      .addOrderBy('e."createdAt"', 'DESC')
      .take(query.limit);
    if (query.from)
      qb.andWhere('e."entryDate" >= :from', { from: startOfDayUtc(query.from) });
    if (query.to) {
      const to = startOfDayUtc(query.to);
      to.setUTCDate(to.getUTCDate() + 1);
      qb.andWhere('e."entryDate" < :to', { to });
    }
    if (query.referenceType)
      qb.andWhere('e."referenceType" = :type', { type: query.referenceType });
    if (query.ledgerAccountId)
      qb.andWhere('e."lines" @> :line::jsonb', {
        line: JSON.stringify([{ ledgerAccountId: query.ledgerAccountId }]),
      });
    return qb.getMany();
  }

  async getJournal(tenantId: string, id: string): Promise<JournalEntry> {
    const entry = await this.journal.findOne({ where: { id, tenantId } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  /**
   * Posts a journal an accountant wrote: an accrual, depreciation, a
   * correction, an opening balance brought in from the previous system.
   *
   * Lines name accounts from the chart directly. Accounts a sub-ledger owns
   * (receivables, payables, stock) are refused — see
   * `SUBLEDGER_CONTROLLED_ROLES`. A line on a bank account's ledger account
   * moves that account's balance too, so treasury and the ledger keep
   * agreeing; that is only possible for an account in base currency, because
   * a journal states base-currency amounts and has no rate to convert at.
   */
  async postManual(
    tenantId: string,
    actorId: string,
    payload: ManualJournalPayload,
    outer?: EntityManager,
  ): Promise<JournalEntry> {
    const run = async (manager: EntityManager) => {
      const ids = [...new Set(payload.lines.map((l) => l.ledgerAccountId))];
      const found = await manager.getRepository(LedgerAccount).find({
        where: { id: In(ids), tenantId, deletedAt: IsNull() },
      });
      const byId = new Map(found.map((a) => [a.id, a]));
      for (const id of ids) {
        const account = byId.get(id);
        if (!account)
          throw new NotFoundException(`Ledger account ${id} not found`);
        if (!account.isActive)
          throw new BadRequestException(
            `${account.code} ${account.name} is inactive. Reactivate it in the chart of accounts first.`,
          );
        if (account.role === 'CASH')
          throw new BadRequestException(
            `${account.code} ${account.name} only groups the bank and cash accounts. Post to the account the money is in.`,
          );
        if (account.role && SUBLEDGER_CONTROLLED_ROLES.includes(account.role))
          throw new BadRequestException(
            `${account.code} ${account.name} is kept by its documents, so a journal cannot post to it. Correct it with a credit note, a bill or a stock adjustment.`,
          );
      }

      const cashByLedger = await this.cashAccountsFor(manager, tenantId, ids);
      const base = await baseCurrencyFor(manager, tenantId);
      for (const cash of cashByLedger.values()) {
        const currency = (cash.currency ?? base).trim().toUpperCase();
        if (currency !== base)
          throw new BadRequestException(
            `${cash.name} holds ${currency}. A journal states ${base} amounts, so it cannot move a ${currency} account; record a transfer or a payment instead.`,
          );
      }

      const lines: JournalLineInput[] = payload.lines.map((l) => {
        const account = byId.get(l.ledgerAccountId)!;
        return {
          ledgerAccountId: account.id,
          financeAccountId: cashByLedger.get(account.id)?.id,
          accountName: account.name,
          debit: money(l.debit),
          credit: money(l.credit),
          description: l.description ?? payload.memo,
        };
      });

      const entry = await this.saveEntry(manager, tenantId, actorId, {
        entryDate: startOfDayUtc(payload.entryDate),
        memo: payload.memo,
        lines,
        referenceId: null,
        reversesEntryId: null,
      });
      await this.moveCashBalances(manager, tenantId, cashByLedger, lines);
      return entry;
    };
    return outer ? run(outer) : this.dataSource.transaction(run);
  }

  /**
   * Posts the mirror image of a manual journal.
   *
   * Only manual journals: an entry a document posted is undone through the
   * document (void the invoice, reverse the payment), or the document and
   * the ledger would disagree. Once per entry, enforced by a unique index.
   */
  async reverse(
    tenantId: string,
    actorId: string,
    id: string,
    payload: ReverseJournalSchemaPayload,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const original = await manager
        .getRepository(JournalEntry)
        .findOne({ where: { id, tenantId } });
      if (!original) throw new NotFoundException('Journal entry not found');
      if (!original.referenceId.startsWith(MANUAL_REFERENCE_PREFIX)) {
        throw new BadRequestException(
          `${original.entryNumber} was posted by a document. Reverse it through that document instead.`,
        );
      }
      if (original.reversesEntryId) {
        throw new BadRequestException(
          `${original.entryNumber} is itself a reversal. Post a new journal instead.`,
        );
      }
      const already = await manager
        .getRepository(JournalEntry)
        .findOne({ where: { tenantId, reversesEntryId: original.id } });
      if (already) {
        throw new ConflictException(
          `${original.entryNumber} was already reversed by ${already.entryNumber}.`,
        );
      }

      const lines: JournalLineInput[] = original.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        financeAccountId: l.financeAccountId ?? undefined,
        accountName: l.accountName,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        description: `Reversal: ${l.description}`,
      }));
      const cashByLedger = await this.cashAccountsFor(
        manager,
        tenantId,
        lines.map((l) => l.ledgerAccountId!),
      );

      const entry = await this.saveEntry(manager, tenantId, actorId, {
        entryDate: startOfDayUtc(payload.entryDate ?? todayUtc()),
        memo:
          payload.memo ??
          `Reversal of ${original.entryNumber}${original.memo ? `: ${original.memo}` : ''}`,
        lines,
        referenceId: `${MANUAL_REFERENCE_PREFIX}reversal:${original.id}`,
        reversesEntryId: original.id,
      });
      await this.moveCashBalances(manager, tenantId, cashByLedger, lines);
      return entry;
    });
  }

  private async saveEntry(
    manager: EntityManager,
    tenantId: string,
    actorId: string,
    input: {
      entryDate: Date;
      memo: string;
      lines: JournalLineInput[];
      referenceId: string | null;
      reversesEntryId: string | null;
    },
  ): Promise<JournalEntry> {
    const resolved = await this.ledger.resolveLines(
      tenantId,
      input.lines,
      manager,
    );
    const entryNumber = formatSequenceNumber(
      'JNL',
      await allocateNextSequenceValue(manager, tenantId, 'journal_number'),
    );
    const repo = manager.getRepository(JournalEntry);
    return repo.save(
      repo.create({
        tenantId,
        entryNumber,
        referenceType: 'MANUAL',
        referenceId:
          input.referenceId ?? `${MANUAL_REFERENCE_PREFIX}${entryNumber}`,
        entryDate: input.entryDate,
        totalAmount: money(
          resolved.reduce((s, l) => s + (Number(l.debit) || 0), 0),
        ),
        lines: resolved,
        memo: input.memo,
        createdById: actorId,
        reversesEntryId: input.reversesEntryId,
      }),
    );
  }

  /** The bank and cash accounts behind any of these ledger accounts. */
  private async cashAccountsFor(
    manager: EntityManager,
    tenantId: string,
    ledgerAccountIds: string[],
  ): Promise<Map<string, FinanceAccount>> {
    if (!ledgerAccountIds.length) return new Map();
    const rows = await manager.getRepository(FinanceAccount).find({
      where: { tenantId, ledgerAccountId: In([...new Set(ledgerAccountIds)]) },
    });
    return new Map(rows.map((a) => [a.ledgerAccountId!, a]));
  }

  /** Relative updates, as every other posting does: never read-modify-write. */
  private async moveCashBalances(
    manager: EntityManager,
    tenantId: string,
    cashByLedger: Map<string, FinanceAccount>,
    lines: JournalLineInput[],
  ): Promise<void> {
    const delta = new Map<string, number>();
    for (const line of lines) {
      const cash = line.ledgerAccountId
        ? cashByLedger.get(line.ledgerAccountId)
        : undefined;
      if (!cash) continue;
      delta.set(
        cash.id,
        money((delta.get(cash.id) ?? 0) + line.debit - line.credit),
      );
    }
    for (const [id, amount] of delta) {
      if (amount === 0) continue;
      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" + $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [amount, id, tenantId],
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Chart of accounts
   * ------------------------------------------------------------------ */

  async createAccount(
    tenantId: string,
    payload: CreateLedgerAccountSchemaPayload,
  ): Promise<LedgerAccount> {
    if (payload.parentId)
      await this.assertParent(tenantId, null, payload.parentId, payload.type);
    try {
      return await this.accounts.save(
        this.accounts.create({
          tenantId,
          code: payload.code,
          name: payload.name,
          type: payload.type,
          role: null,
          parentId: payload.parentId,
          description: payload.description,
          isSystem: false,
          isActive: true,
        }),
      );
    } catch (err) {
      throw this.duplicateCode(err, payload.code);
    }
  }

  /**
   * Renames, re-describes, re-parents or retires an account.
   *
   * A system account keeps its code and stays active: the application posts
   * to it on its own, and retiring it would make the next invoice or payroll
   * run fail. A tenant's own account may change code, and may be retired
   * once nothing should post to it any more — its history stays.
   */
  async updateAccount(
    tenantId: string,
    id: string,
    payload: UpdateLedgerAccountSchemaPayload,
  ): Promise<LedgerAccount> {
    const account = await this.accounts.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Ledger account not found');

    if (account.isSystem) {
      if (payload.code !== undefined && payload.code !== account.code)
        throw new BadRequestException(
          `${account.code} is a system account; its code cannot change.`,
        );
      if (payload.isActive === false)
        throw new BadRequestException(
          `${account.code} ${account.name} is posted to automatically and cannot be deactivated.`,
        );
    }
    if (payload.parentId !== undefined && payload.parentId !== null)
      await this.assertParent(tenantId, account.id, payload.parentId, account.type);

    if (payload.code !== undefined) account.code = payload.code;
    if (payload.name !== undefined) account.name = payload.name;
    if (payload.description !== undefined)
      account.description = payload.description;
    if (payload.parentId !== undefined) account.parentId = payload.parentId;
    if (payload.isActive !== undefined) account.isActive = payload.isActive;
    try {
      return await this.accounts.save(account);
    } catch (err) {
      throw this.duplicateCode(err, account.code);
    }
  }

  /**
   * Removes an account added by mistake. Anything posted to it, anything
   * nested under it, or a tax code pointing at it means it is part of the
   * books: deactivate it instead.
   */
  async deleteAccount(tenantId: string, id: string): Promise<{ id: string }> {
    const account = await this.accounts.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Ledger account not found');
    if (account.isSystem)
      throw new BadRequestException('System accounts cannot be deleted.');

    const [posted, children, taxCodes] = await Promise.all([
      this.journal
        .createQueryBuilder('e')
        .where('e."tenantId" = :tenantId', { tenantId })
        .andWhere('e."lines" @> :line::jsonb', {
          line: JSON.stringify([{ ledgerAccountId: id }]),
        })
        .getCount(),
      this.accounts.count({
        where: { tenantId, parentId: id, deletedAt: IsNull() },
      }),
      this.dataSource.query<{ n: string }[]>(
        `SELECT COUNT(*)::text AS n FROM "tax_codes" WHERE "tenant_id" = $1 AND "ledger_account_id" = $2`,
        [tenantId, id],
      ),
    ]);
    if (posted > 0 || children > 0 || Number(taxCodes[0]?.n ?? 0) > 0) {
      throw new ConflictException(
        `${account.code} ${account.name} is in use (${[
          posted && `${posted} journal entr${posted === 1 ? 'y' : 'ies'}`,
          children && `${children} sub-account(s)`,
          Number(taxCodes[0]?.n) && 'a tax code',
        ]
          .filter(Boolean)
          .join(', ')}). Deactivate it instead.`,
      );
    }
    await this.accounts.softDelete({ id, tenantId });
    return { id };
  }

  private async assertParent(
    tenantId: string,
    selfId: string | null,
    parentId: string,
    type: LedgerAccount['type'],
  ): Promise<void> {
    if (parentId === selfId)
      throw new BadRequestException('An account cannot be its own parent.');
    const all = await this.accounts.find({
      where: { tenantId, deletedAt: IsNull() },
      select: { id: true, parentId: true, type: true, code: true },
    });
    const byId = new Map(all.map((a) => [a.id, a]));
    const parent = byId.get(parentId);
    if (!parent) throw new NotFoundException('Parent account not found');
    if (parent.type !== type)
      throw new BadRequestException(
        `A ${type.toLowerCase()} account cannot sit under ${parent.code}, which is ${parent.type.toLowerCase()}.`,
      );
    // Walk up from the parent: meeting ourselves means a cycle.
    let cursor: string | null = parent.parentId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === selfId)
        throw new BadRequestException(
          'That would nest the account under itself.',
        );
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  private duplicateCode(err: unknown, code: string): unknown {
    return err instanceof QueryFailedError &&
      (err as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
      ? new ConflictException(`Account code ${code} is already in use.`)
      : err;
  }
}
