import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  costMoved,
  hasQuickCostInputs,
  type QuoteCostCheck,
  type QuoteLineItem,
  type QuoteRecostMode,
} from '@saas/shared';
import { CostingService } from '../catalog/costing.service';
import { Quote, QuoteStatus } from './entities/quote.entity';
import { QuotesService } from './quotes.service';

/** Statuses a quote can be re-costed in: not decided by the customer yet. */
const OPEN_STATUSES = [
  QuoteStatus.DRAFT,
  QuoteStatus.AWAITING_APPROVAL,
  QuoteStatus.APPROVED,
];
/** Enough for any shop's open pipeline; bounded so the check stays cheap. */
const MAX_OPEN_QUOTES = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;
const marginOf = (subtotal: number, cost: number) =>
  subtotal > 0
    ? Math.round(((subtotal - cost) / subtotal) * 10_000) / 10_000
    : null;

/**
 * Open quotes priced on costs that have since moved.
 *
 * A quote keeps the cost it was saved with; this says how far today's
 * catalog is from it, line by line, and re-costs on request through the
 * ordinary quote update, so the figures are worked out on the server as on
 * any save. Accepted and replaced quotes are never touched: their order (and
 * any job) was made at the old cost and should stay there.
 */
@Injectable()
export class QuoteCostCheckService {
  constructor(
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly costing: CostingService,
    private readonly quotesService: QuotesService,
  ) {}

  /** Open quotes whose costs have moved, largest margin drop first. */
  async openQuotesWithMovedCosts(tenantId: string): Promise<QuoteCostCheck[]> {
    const open = await this.quotes.find({
      where: {
        tenantId,
        status: In(OPEN_STATUSES),
        acceptedAt: IsNull(),
        supersededAt: IsNull(),
      },
      order: { updatedAt: 'DESC' },
      take: MAX_OPEN_QUOTES,
    });
    const checks: QuoteCostCheck[] = [];
    for (const quote of open) {
      const check = await this.checkQuote(tenantId, quote);
      if (check.moved) checks.push(check);
    }
    const drop = (c: QuoteCostCheck) =>
      (c.savedMarginPct ?? 0) - (c.currentMarginPct ?? 0);
    return checks.sort((a, b) => drop(b) - drop(a));
  }

  async check(tenantId: string, id: string): Promise<QuoteCostCheck> {
    const quote = await this.quotesService.findQuoteById(tenantId, id);
    return this.checkQuote(tenantId, quote);
  }

  /**
   * Re-costs an open quote at today's catalog. `COSTS` changes only the cost
   * behind each line, so the customer sees nothing new and an outstanding
   * acceptance link stays valid. `COSTS_AND_PRICES` also re-prices template
   * lines from the template's markup; not allowed once the price is approved.
   */
  async recost(
    tenantId: string,
    id: string,
    mode: QuoteRecostMode,
    actorUserId: string | null,
  ): Promise<Quote> {
    const quote = await this.quotesService.findQuoteById(tenantId, id);
    this.assertOpen(quote);
    let items: QuoteLineItem[] = quote.items ?? [];
    if (mode === 'COSTS_AND_PRICES') {
      if (quote.status === QuoteStatus.APPROVED) {
        throw new BadRequestException(
          `${quote.quoteNumber ?? 'This quote'} is approved, so its prices are fixed. Re-cost without changing prices, or create a revision.`,
        );
      }
      const { templatePrices } = await this.costing.recostLines(
        tenantId,
        items,
      );
      items = items.map((line) =>
        templatePrices[line.id] != null
          ? { ...line, unitPrice: templatePrices[line.id] }
          : line,
      );
    }
    // The ordinary update: it discards any cost on the lines and costs them
    // again from the catalog, then re-taxes and re-totals.
    return this.quotesService.updateQuote(tenantId, id, { items }, actorUserId);
  }

  private assertOpen(quote: Quote): void {
    if (quote.acceptedAt || quote.supersededAt) {
      throw new BadRequestException(
        `${quote.quoteNumber ?? 'This quote'} has been ${quote.acceptedAt ? 'accepted' : 'replaced by a revision'}; it keeps the costs it was made with.`,
      );
    }
    if (!OPEN_STATUSES.includes(quote.status)) {
      throw new BadRequestException(
        `${quote.quoteNumber ?? 'This quote'} is ${quote.status.toLowerCase()}; only open quotes are re-costed.`,
      );
    }
  }

  private async checkQuote(
    tenantId: string,
    quote: Quote,
  ): Promise<QuoteCostCheck> {
    const items = quote.items ?? [];
    const today = await this.costing.recostLines(tenantId, items);
    const byId = new Map(today.items.map((l) => [l.id, l]));
    const stale = new Set(today.staleLineIds);

    const lines = items
      .filter(
        (l) =>
          l.type === 'product' &&
          (l.templateId || l.catalogItemId || hasQuickCostInputs(l.quickCost)),
      )
      .map((l) => {
        const now = byId.get(l.id);
        return {
          lineId: l.id,
          description: l.description,
          quantity: Number(l.quantity) || 0,
          savedCost: l.cost ? Number(l.cost.totalCost) : null,
          currentCost:
            stale.has(l.id) || !now?.cost ? null : Number(now.cost.totalCost),
          unitPrice: Number(l.unitPrice) || 0,
          repricedUnitPrice: today.templatePrices[l.id] ?? null,
        };
      });

    const saved = calculateQuoteTotals(items);
    const repriced = calculateQuoteTotals(
      today.items.map((l) =>
        today.templatePrices[l.id] != null
          ? { ...l, unitPrice: today.templatePrices[l.id] }
          : l,
      ),
    );
    const subtotal = round2(saved.subtotalAmount);
    const savedCost = round2(saved.costAmount);
    const currentCost = round2(today.totals.costAmount);
    const repricedSubtotal = round2(repriced.subtotalAmount);

    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      customerName: quote.customerName,
      status: quote.status,
      currency: quote.currency,
      moved:
        today.movedLineIds.length > 0 ||
        lines.some(
          (l) => l.savedCost != null && costMoved(l.savedCost, l.currentCost),
        ),
      savedCost,
      currentCost,
      subtotal,
      savedMarginPct: marginOf(subtotal, savedCost),
      currentMarginPct: marginOf(subtotal, currentCost),
      repricedSubtotal,
      repricedMarginPct: marginOf(repricedSubtotal, currentCost),
      canReprice:
        quote.status !== QuoteStatus.APPROVED &&
        lines.some(
          (l) =>
            l.repricedUnitPrice != null &&
            Math.abs(l.repricedUnitPrice - l.unitPrice) >= 0.01,
        ),
      lines,
    };
  }
}
