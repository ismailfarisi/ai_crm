import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  invoicePosition,
  LEDGER_ROLES,
  monthEnd,
  revaluationDelta,
  type CurrencySettingsDto,
  type FxRateDto,
  type FxRatePayload,
  type JournalLineInput,
  type RevaluationResultDto,
} from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { FxRate } from './entities/fx-rate.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { baseCurrencyFor, fxRateFor } from './fx';
import { LedgerService } from './ledger.service';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const round2 = (n: number) => cents(n) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class CurrencyService {
  constructor(
    @InjectRepository(FxRate) private readonly rates: Repository<FxRate>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(SupplierBill)
    private readonly bills: Repository<SupplierBill>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  async settings(tenantId: string): Promise<CurrencySettingsDto> {
    const base = await baseCurrencyFor(this.dataSource.manager, tenantId);
    const [posted, inUse, latest] = await Promise.all([
      this.journal.count({ where: { tenantId } }),
      this.dataSource.query<{ currency: string }[]>(
        `SELECT DISTINCT currency FROM (
           SELECT "currency" FROM "invoices" WHERE "tenant_id" = $1
           UNION SELECT "currency" FROM "supplier_bills" WHERE "tenant_id" = $1
           UNION SELECT "currency" FROM "purchase_orders" WHERE "tenant_id" = $1
           UNION SELECT "currency" FROM "quotes" WHERE "tenant_id" = $1
           UNION SELECT "currency" FROM "finance_accounts" WHERE "tenantId" = $1
           UNION SELECT "currency" FROM "fx_rates" WHERE "tenant_id" = $1
         ) c WHERE currency IS NOT NULL`,
        [tenantId],
      ),
      this.dataSource.query<
        { currency: string; rate: string; rate_date: string | Date }[]
      >(
        `SELECT DISTINCT ON ("currency") "currency", "rate", "rate_date"
         FROM "fx_rates" WHERE "tenant_id" = $1
         ORDER BY "currency", "rate_date" DESC`,
        [tenantId],
      ),
    ]);
    const codes = [
      ...new Set(inUse.map((r) => r.currency.trim().toUpperCase())),
    ]
      .filter((c) => c !== base)
      .sort();
    return {
      baseCurrency: base,
      canChangeBaseCurrency: posted === 0,
      currencies: codes.map((currency) => {
        const row = latest.find((r) => r.currency.trim() === currency);
        return {
          currency,
          latestRate: row ? Number(row.rate) : null,
          latestRateDate: row ? day(new Date(row.rate_date)) : null,
        };
      }),
    };
  }

  /**
   * Changing base currency would restate every posted amount, so it is only
   * allowed before anything has been posted.
   */
  async setBaseCurrency(
    tenantId: string,
    currency: string,
  ): Promise<CurrencySettingsDto> {
    const posted = await this.journal.count({ where: { tenantId } });
    if (posted > 0) {
      throw new ConflictException(
        'Base currency cannot change once anything has been posted: every entry in the ledger is in it.',
      );
    }
    await this.organizations.update(
      { id: tenantId },
      { baseCurrency: currency },
    );
    return this.settings(tenantId);
  }

  async listRates(tenantId: string, currency?: string): Promise<FxRateDto[]> {
    const rows = await this.rates.find({
      where: {
        tenantId,
        ...(currency ? { currency: currency.toUpperCase() } : {}),
      },
      order: { rateDate: 'DESC', currency: 'ASC' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      currency: r.currency.trim(),
      rateDate:
        typeof r.rateDate === 'string' ? r.rateDate : day(new Date(r.rateDate)),
      rate: r.rate,
      source: r.source,
    }));
  }

  /**
   * Adds a day's rate, or corrects it. A correction only affects documents
   * posted afterwards; those already posted keep the rate they snapshotted.
   */
  async upsertRate(tenantId: string, input: FxRatePayload): Promise<FxRateDto> {
    const base = await baseCurrencyFor(this.dataSource.manager, tenantId);
    if (input.currency === base) {
      throw new BadRequestException(
        `${base} is the base currency; its rate is always 1`,
      );
    }
    const rateDate = day(input.rateDate);
    await this.dataSource.query(
      `INSERT INTO "fx_rates" ("tenant_id", "currency", "rate_date", "rate", "source")
       VALUES ($1, $2, $3, $4, 'manual')
       ON CONFLICT ("tenant_id", "currency", "rate_date")
       DO UPDATE SET "rate" = EXCLUDED."rate", "source" = EXCLUDED."source", "updatedAt" = now()`,
      [tenantId, input.currency, rateDate, input.rate],
    );
    const [row] = await this.listRates(tenantId, input.currency);
    return row;
  }

  async deleteRate(tenantId: string, id: string): Promise<void> {
    const result = await this.rates.delete({ id, tenantId });
    if (!result.affected)
      throw new NotFoundException('Exchange rate not found');
  }

  /**
   * Restates open foreign-currency receivables and payables at the rate on
   * the last day of a month, and reverses it on the first of the next.
   *
   * The reversal is what keeps this honest: the revaluation shows what open
   * balances were worth at month end, for that month's balance sheet, and
   * then steps aside so the real gain or loss is taken when the invoice or
   * bill actually settles. Without it the same difference would be counted
   * twice.
   *
   * One revaluation per month. Documents whose currency has no rate on the
   * date are left out and listed, rather than stopping the whole run.
   */
  async revalue(tenantId: string, period: Date): Promise<RevaluationResultDto> {
    const end = monthEnd(period);
    const label = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`;
    const entryNumber = `JE-REVAL-${label}`;

    return this.dataSource.transaction(async (manager) => {
      // Serialises two runs for the same month.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${tenantId}:${entryNumber}`,
      ]);
      const existing = await manager
        .getRepository(JournalEntry)
        .findOne({ where: { tenantId, entryNumber } });
      if (existing) {
        throw new ConflictException(`${label} has already been revalued`);
      }

      const base = await baseCurrencyFor(manager, tenantId);
      const endOfDay = new Date(end.getTime() + 86_399_999);
      const [openInvoices, openBills] = await Promise.all([
        manager.getRepository(Invoice).find({
          where: {
            tenantId,
            status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]),
          },
        }),
        manager.getRepository(SupplierBill).find({
          where: { tenantId, status: In(['APPROVED', 'PARTIALLY_PAID']) },
        }),
      ]);

      const rateCache = new Map<string, number | null>();
      const missing = new Set<string>();
      const rateFor = async (currency: string) => {
        const code = currency.trim().toUpperCase();
        if (!rateCache.has(code)) {
          try {
            rateCache.set(code, await fxRateFor(manager, tenantId, code, end));
          } catch {
            rateCache.set(code, null);
          }
        }
        const rate = rateCache.get(code) ?? null;
        if (rate == null) missing.add(code);
        return rate;
      };

      let arDelta = 0;
      let arDocs = 0;
      for (const invoice of openInvoices) {
        if (
          invoice.currency.trim().toUpperCase() === base ||
          invoice.issuedAt > endOfDay
        )
          continue;
        const open = invoicePosition(invoice).balance;
        if (open <= 0) continue;
        const rate = await rateFor(invoice.currency);
        if (rate == null) continue;
        arDelta = round2(
          arDelta + revaluationDelta(open, invoice.fxRate ?? 1, rate),
        );
        arDocs += 1;
      }

      let apDelta = 0;
      let apDocs = 0;
      for (const bill of openBills) {
        if (
          bill.currency.trim().toUpperCase() === base ||
          (bill.approvedAt && bill.approvedAt > endOfDay)
        )
          continue;
        const open = round2(Number(bill.totalAmount) - Number(bill.paidAmount));
        if (open <= 0) continue;
        const rate = await rateFor(bill.currency);
        if (rate == null) continue;
        apDelta = round2(
          apDelta + revaluationDelta(open, bill.fxRate ?? 1, rate),
        );
        apDocs += 1;
      }

      const result: RevaluationResultDto = {
        period: label,
        entryNumber: null,
        receivables: { documents: arDocs, delta: arDelta },
        payables: { documents: apDocs, delta: apDelta },
        missingRates: [...missing].sort(),
      };
      if (cents(arDelta) === 0 && cents(apDelta) === 0) return result;

      // A receivable worth more is a gain; a payable worth more is a loss.
      const net = round2(arDelta - apDelta);
      const description = `Revaluation of open foreign-currency balances at ${day(end)}`;
      const lines: JournalLineInput[] = [];
      if (arDelta !== 0) {
        lines.push({
          role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
          accountName: 'Accounts Receivable',
          debit: Math.max(arDelta, 0),
          credit: Math.max(-arDelta, 0),
          description,
        });
      }
      if (apDelta !== 0) {
        lines.push({
          role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
          accountName: 'Accounts payable',
          debit: Math.max(-apDelta, 0),
          credit: Math.max(apDelta, 0),
          description,
        });
      }
      if (net !== 0) {
        lines.push({
          role: LEDGER_ROLES.FX_GAIN_LOSS,
          accountName: 'Exchange gains and losses',
          debit: Math.max(-net, 0),
          credit: Math.max(net, 0),
          description,
        });
      }

      const repo = manager.getRepository(JournalEntry);
      const resolved = await this.ledger.resolveLines(tenantId, lines, manager);
      await repo.save(
        repo.create({
          tenantId,
          entryNumber,
          referenceType: 'MANUAL',
          referenceId: label,
          entryDate: end,
          totalAmount: Math.abs(arDelta) + Math.abs(apDelta),
          lines: resolved,
        }),
      );
      const firstOfNext = new Date(end.getTime() + 86_400_000);
      await repo.save(
        repo.create({
          tenantId,
          entryNumber: `${entryNumber}-REV`,
          referenceType: 'MANUAL',
          referenceId: label,
          entryDate: firstOfNext,
          totalAmount: Math.abs(arDelta) + Math.abs(apDelta),
          lines: resolved.map((line) => ({
            ...line,
            debit: line.credit,
            credit: line.debit,
            description: `Reversal: ${line.description}`,
          })),
        }),
      );
      return { ...result, entryNumber };
    });
  }
}
