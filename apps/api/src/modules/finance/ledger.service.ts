import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import {
  CASH_ACCOUNT_CODE_PREFIX,
  convertLines,
  fxBalancingLine,
  isBalanced,
  journalDifference,
  LEDGER_ROLES,
  NORMAL_BALANCE,
  SYSTEM_LEDGER_ACCOUNTS,
  type JournalLineDto,
  type JournalLineInput,
  type LedgerRole,
  type TrialBalanceDto,
  type TrialBalanceRowDto,
} from '@saas/shared';
import { FinanceAccount } from './entities/finance-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerAccount } from './entities/ledger-account.entity';

/**
 * Fallbacks for lines written before roles existed, and for any caller that
 * still passes only a name. Matched case-insensitively on the exact label the
 * old code wrote — see the literals in `finance.service.ts` and
 * `expense-approval.workflow.ts` before this sprint.
 */
const LEGACY_NAME_TO_ROLE: Record<string, LedgerRole> = {
  'accounts receivable': LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
  'accounts payable': LEDGER_ROLES.ACCOUNTS_PAYABLE,
  'bank account': LEDGER_ROLES.CASH,
  'operating expense': LEDGER_ROLES.OPERATING_EXPENSE,
};

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    private readonly dataSource: DataSource,
  ) {}

  /* ------------------------------------------------------------------ *
   * Provisioning
   * ------------------------------------------------------------------ */

  /**
   * Creates this tenant's chart of accounts.
   *
   * Called from the signup transaction alongside `provisionSystemRoles`, so a
   * tenant can never exist without somewhere to post. Idempotent: re-running
   * it leaves the existing chart alone, which is what makes it safe to call
   * from a migration backfill as well as from signup.
   */
  async provisionChartOfAccounts(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LedgerAccount[]> {
    const repo = manager.getRepository(LedgerAccount);
    const existing = await repo.find({ where: { tenantId } });
    const byCode = new Map(existing.map((a) => [a.code, a]));

    const created: LedgerAccount[] = [];
    for (const definition of SYSTEM_LEDGER_ACCOUNTS) {
      const already = byCode.get(definition.code);
      if (already) {
        created.push(already);
        continue;
      }
      created.push(
        await repo.save(
          repo.create({
            tenantId,
            code: definition.code,
            name: definition.name,
            type: definition.type,
            role: definition.role,
            description: definition.description,
            isSystem: true,
            isActive: true,
          }),
        ),
      );
    }
    return created;
  }

  /**
   * Gives a cash account its own ledger account, nested under `1000`.
   *
   * One per bank account rather than pooling them all into `1000`, so a trial
   * balance shows a figure per bank that can actually be reconciled against a
   * statement.
   */
  async ensureCashLedgerAccount(
    tenantId: string,
    account: FinanceAccount,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LedgerAccount> {
    const repo = manager.getRepository(LedgerAccount);
    if (account.ledgerAccountId) {
      const existing = await repo.findOne({
        where: { id: account.ledgerAccountId, tenantId },
      });
      if (existing) return existing;
    }

    const parent = await repo.findOne({
      where: { tenantId, role: LEDGER_ROLES.CASH },
    });

    // Codes run 1001, 1002, ... under the 1000 parent. Computed from what is
    // already there so a gap left by a deleted account is not reused.
    const siblings = await repo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.code LIKE :prefix', {
        prefix: `${CASH_ACCOUNT_CODE_PREFIX}%`,
      })
      .andWhere('a.code <> :parentCode', { parentCode: '1000' })
      .getMany();
    const next = 1001 + siblings.length;

    const created = await repo.save(
      repo.create({
        tenantId,
        code: String(next),
        name: account.name,
        type: 'ASSET',
        role: null,
        parentId: parent?.id ?? null,
        isSystem: true,
        isActive: true,
        description: `Cash account: ${account.name}`,
      }),
    );

    await manager
      .getRepository(FinanceAccount)
      .update({ id: account.id }, { ledgerAccountId: created.id });

    return created;
  }

  /* ------------------------------------------------------------------ *
   * Lookups
   * ------------------------------------------------------------------ */

  async list(tenantId: string): Promise<LedgerAccount[]> {
    return this.accounts.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { code: 'ASC' },
    });
  }

  async byRole(
    tenantId: string,
    role: LedgerRole,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LedgerAccount> {
    const found = await manager.getRepository(LedgerAccount).findOne({
      where: { tenantId, role, deletedAt: IsNull() },
    });
    if (!found) {
      // Provisioning runs at signup, so this means the chart was never
      // created or an account was deleted out from under the application.
      throw new NotFoundException(
        `Ledger account for role ${role} is missing from this organization's chart of accounts`,
      );
    }
    return found;
  }

  /* ------------------------------------------------------------------ *
   * Posting
   * ------------------------------------------------------------------ */

  /**
   * Turns caller-stated lines into stored lines.
   *
   * A line names either a `financeAccountId` (it moves a specific bank
   * balance) or a `role`. Anything with neither is matched against the labels
   * the pre-ledger code used, and falls back to operating expense — an
   * expense category like "Travel" has no account of its own.
   */
  async resolveLines(
    tenantId: string,
    input: JournalLineInput[],
    manager: EntityManager = this.dataSource.manager,
    /**
     * Base currency per unit of the document's currency. Lines are given in
     * the document's currency and stored in base; a line may carry its own
     * `fxRate`. Any difference that leaves posts to exchange gains and losses.
     */
    entryRate = 1,
  ): Promise<JournalLineDto[]> {
    // Balanced in the document's own currency first: an exchange difference
    // is legitimate, a caller's arithmetic mistake is not, and after
    // conversion the two would be indistinguishable.
    if (!isBalanced(input)) {
      throw new BadRequestException(
        `Journal entry does not balance: debits minus credits is ${journalDifference(input)}`,
      );
    }

    let lines = input;
    const converts =
      entryRate !== 1 ||
      input.some((line) => line.fxRate != null && line.fxRate !== 1);
    if (converts) {
      const converted = convertLines(input, entryRate);
      const balancing = fxBalancingLine(converted.imbalance);
      lines = balancing
        ? [
            ...converted.lines,
            {
              role: LEDGER_ROLES.FX_GAIN_LOSS,
              accountName: 'Exchange gains and losses',
              ...balancing,
              description:
                Math.abs(converted.imbalance) <= 0.02 * input.length
                  ? 'Currency conversion rounding'
                  : 'Exchange difference',
            },
          ]
        : converted.lines;
    }

    const resolved: JournalLineDto[] = [];

    for (const line of lines) {
      let ledger: LedgerAccount;

      if (line.ledgerAccountId) {
        const chosen = await manager.getRepository(LedgerAccount).findOne({
          where: { id: line.ledgerAccountId, tenantId, deletedAt: IsNull() },
        });
        if (!chosen) {
          throw new NotFoundException(
            `Ledger account ${line.ledgerAccountId} not found`,
          );
        }
        ledger = chosen;
      } else if (line.financeAccountId) {
        const cash = await manager.getRepository(FinanceAccount).findOne({
          where: { id: line.financeAccountId, tenantId },
        });
        if (!cash) {
          throw new NotFoundException(
            `Account ${line.financeAccountId} not found`,
          );
        }
        ledger = await this.ensureCashLedgerAccount(tenantId, cash, manager);
      } else {
        const role =
          line.role ??
          LEGACY_NAME_TO_ROLE[(line.accountName ?? '').trim().toLowerCase()];
        if (!role) {
          this.logger.debug(
            `Journal line "${line.accountName}" has no role; posting to operating expense`,
          );
        }
        ledger = await this.byRole(
          tenantId,
          role ?? LEDGER_ROLES.OPERATING_EXPENSE,
          manager,
        );
      }

      resolved.push({
        ledgerAccountId: ledger.id,
        ledgerAccountCode: ledger.code,
        financeAccountId: line.financeAccountId ?? null,
        accountName: line.accountName,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
      });
    }

    if (!isBalanced(resolved)) {
      // Refusing here rather than storing it is the difference between one
      // failed request and a trial balance that never balances again.
      throw new BadRequestException(
        `Journal entry does not balance: debits minus credits is ${journalDifference(resolved)}`,
      );
    }

    return resolved;
  }

  /* ------------------------------------------------------------------ *
   * Reporting
   * ------------------------------------------------------------------ */

  /**
   * Debits and credits per account across every posted entry.
   *
   * `difference` is the single number worth watching: anything other than
   * zero means something was written that should not have been, and it is
   * cheaper to find on the day it happens than at year end.
   */
  async trialBalance(tenantId: string, asOf?: Date): Promise<TrialBalanceDto> {
    const [accounts, entries] = await Promise.all([
      this.list(tenantId),
      // An entry dated after `asOf` has not happened yet as far as this
      // balance is concerned — a revaluation's reversal is dated the first of
      // next month for exactly that reason.
      this.journal.find({
        where: asOf
          ? { tenantId, entryDate: LessThanOrEqual(asOf) }
          : { tenantId },
      }),
    ]);

    const totals = new Map<string, { debit: number; credit: number }>();
    for (const entry of entries) {
      for (const line of entry.lines ?? []) {
        const key = line.ledgerAccountId;
        if (!key) continue;
        const bucket = totals.get(key) ?? { debit: 0, credit: 0 };
        bucket.debit += Number(line.debit ?? 0);
        bucket.credit += Number(line.credit ?? 0);
        totals.set(key, bucket);
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows: TrialBalanceRowDto[] = accounts
      .map((account) => {
        const bucket = totals.get(account.id) ?? { debit: 0, credit: 0 };
        const signed =
          NORMAL_BALANCE[account.type] === 'DEBIT'
            ? bucket.debit - bucket.credit
            : bucket.credit - bucket.debit;
        return {
          ledgerAccountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          debit: round(bucket.debit),
          credit: round(bucket.credit),
          balance: round(signed),
        };
      })
      .filter((row) => row.debit !== 0 || row.credit !== 0);

    const totalDebit = round(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round(rows.reduce((s, r) => s + r.credit, 0));

    return {
      rows,
      totalDebit,
      totalCredit,
      difference: round(totalDebit - totalCredit),
    };
  }
}
