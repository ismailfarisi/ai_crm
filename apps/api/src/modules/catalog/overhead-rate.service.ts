import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  LEDGER_ROLES,
  suggestOverheadRate,
  type CostingPolicy as CostingPolicySpec,
  type OverheadLedgerAccount,
  type OverheadSuggestion,
  type OverheadSuggestionDto,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerAccount } from '../finance/entities/ledger-account.entity';
import { baseCurrencyFor } from '../finance/fx';
import { CostingService } from './costing.service';
import { ProductTemplate } from './entities/product-template.entity';

/**
 * Works out the shop-wide overhead rate from the ledger.
 *
 * Direct cost is cost of sales: the COGS account and anything else in the
 * 5xxx range. Overhead is every running cost of the business: the operating
 * expense accounts (6xxx, or any account filed under them), net of labour
 * absorbed into jobs, which is a credit there. Exchange differences, tax and
 * anything outside those ranges are neither.
 */
@Injectable()
export class OverheadRateService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(ProductTemplate)
    private readonly templates: Repository<ProductTemplate>,
    private readonly costing: CostingService,
  ) {}

  async suggest(
    tenantId: string,
    months: number,
    excludeAccountCodes: string[] = [],
    today = new Date(),
  ): Promise<OverheadSuggestionDto> {
    const [suggestion, currency, policy, templates] = await Promise.all([
      this.compute(tenantId, months, excludeAccountCodes, today),
      baseCurrencyFor(this.journal.manager, tenantId),
      this.costing.getPolicy(tenantId),
      this.templates.find({
        where: { tenantId, isCurrent: true },
        select: { id: true, name: true, pricing: true },
        order: { name: 'ASC' },
      }),
    ]);
    const own = templates.filter((t) => t.pricing?.overheadPct != null);
    return {
      ...suggestion,
      currency,
      currentPct: policy.defaultOverheadPct,
      templates: {
        usingShopRate: templates
          .filter((t) => t.pricing?.overheadPct == null)
          .map((t) => ({ id: t.id, name: t.name })),
        ownRate: own.map((t) => ({
          id: t.id,
          name: t.name,
          overheadPct: Number(t.pricing.overheadPct),
        })),
      },
    };
  }

  /**
   * Accepts the suggestion. The browser only names the months and the
   * accounts it unticked; the rate itself is worked out again here.
   */
  async accept(
    tenantId: string,
    months: number,
    excludeAccountCodes: string[],
    today = new Date(),
  ): Promise<CostingPolicySpec> {
    const [suggestion, currency] = await Promise.all([
      this.compute(tenantId, months, excludeAccountCodes, today),
      baseCurrencyFor(this.journal.manager, tenantId),
    ]);
    if (
      suggestion.status !== 'READY' ||
      suggestion.suggestedPct === null ||
      !suggestion.from ||
      !suggestion.to
    ) {
      throw new BadRequestException(
        'There is no rate to accept from your books yet. Type a rate instead.',
      );
    }
    return this.costing.setOverheadFromBooks(
      tenantId,
      suggestion.suggestedPct,
      {
        from: suggestion.from,
        to: suggestion.to,
        months: suggestion.monthsCounted,
        overheadTotal: suggestion.overheadTotal,
        directTotal: suggestion.directTotal,
        excludedAccountCodes: suggestion.overheadAccounts
          .filter((a) => !a.included)
          .map((a) => a.code),
        currency,
      },
    );
  }

  private async compute(
    tenantId: string,
    months: number,
    excludeAccountCodes: string[],
    today: Date,
  ): Promise<OverheadSuggestion> {
    const ledger = await this.accounts.find({
      where: { tenantId, type: 'EXPENSE', deletedAt: IsNull() },
    });
    const classified = classifyAccounts(ledger);

    const end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1),
    );

    const [rows, first] = await Promise.all([
      classified.size
        ? this.journal.query<
            Array<{ accountId: string; month: string; amount: string }>
          >(
            `SELECT l->>'ledgerAccountId' AS "accountId",
                    to_char(e."entryDate" AT TIME ZONE 'UTC', 'YYYY-MM') AS "month",
                    SUM(COALESCE((l->>'debit')::numeric, 0) - COALESCE((l->>'credit')::numeric, 0)) AS "amount"
               FROM "journal_entries" e
               CROSS JOIN LATERAL jsonb_array_elements(e."lines") l
              WHERE e."tenantId" = $1
                AND e."entryDate" >= $2
                AND e."entryDate" < $3
                AND l->>'ledgerAccountId' = ANY($4::text[])
              GROUP BY 1, 2`,
            [tenantId, start, end, [...classified.keys()]],
          )
        : Promise.resolve([]),
      this.journal
        .createQueryBuilder('e')
        .select('MIN(e."entryDate")', 'first')
        .where('e."tenantId" = :tenantId', { tenantId })
        .getRawOne<{ first: Date | string | null }>(),
    ]);

    const byAccount = new Map<string, OverheadLedgerAccount>();
    for (const [id, account] of classified) {
      byAccount.set(id, { ...account, byMonth: {} });
    }
    for (const row of rows) {
      const account = byAccount.get(row.accountId);
      if (account) account.byMonth[row.month] = Number(row.amount);
    }

    return suggestOverheadRate({
      today,
      months,
      firstPosting: first?.first ? new Date(first.first) : null,
      accounts: [...byAccount.values()],
      excludeAccountCodes,
    });
  }
}

/** Expense accounts that are direct cost or overhead, by id. */
export function classifyAccounts(
  ledger: Pick<LedgerAccount, 'id' | 'code' | 'name' | 'role' | 'parentId'>[],
): Map<string, Omit<OverheadLedgerAccount, 'byMonth'>> {
  const byId = new Map(ledger.map((a) => [a.id, a]));
  const rootOf = (account: (typeof ledger)[number]) => {
    let current = account;
    const seen = new Set<string>();
    while (
      current.parentId &&
      byId.has(current.parentId) &&
      !seen.has(current.id)
    ) {
      seen.add(current.id);
      current = byId.get(current.parentId)!;
    }
    return current;
  };

  const out = new Map<string, Omit<OverheadLedgerAccount, 'byMonth'>>();
  for (const account of ledger) {
    const root = rootOf(account);
    const direct =
      account.role === LEDGER_ROLES.COGS ||
      root.role === LEDGER_ROLES.COGS ||
      account.code.startsWith('5');
    const overhead =
      !direct &&
      (root.role === LEDGER_ROLES.OPERATING_EXPENSE ||
        account.code.startsWith('6'));
    if (!direct && !overhead) continue;
    out.set(account.id, {
      code: account.code,
      name: account.name,
      role: account.role,
      kind: direct ? 'DIRECT' : 'OVERHEAD',
    });
  }
  return out;
}
