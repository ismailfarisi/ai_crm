import { BadRequestException } from '@nestjs/common';
import { QuoteStatus } from './entities/quote.entity';
import { QuoteCostCheckService } from './quote-cost-check.service';

const TENANT = 'tenant-1';
const line = {
  id: 'l1',
  type: 'product' as const,
  description: 'Rigid gift box',
  quantity: 500,
  unitPrice: 12,
  discount: 0,
  templateId: 't1',
  cost: { unitCost: 8, totalCost: 4000, source: 'COMPUTED' as const },
};

function setup(quote: Record<string, unknown>) {
  const q = {
    id: 'q1',
    quoteNumber: 'Q-0007',
    customerName: 'Gulf Dates',
    currency: 'AED',
    items: [line],
    ...quote,
  };
  const quotes = { find: jest.fn().mockResolvedValue([q]) };
  const costing = {
    recostLines: jest.fn().mockResolvedValue({
      items: [
        { ...line, cost: { ...line.cost, unitCost: 8.6, totalCost: 4300 } },
      ],
      totals: { costAmount: 4300 },
      violations: [],
      staleLineIds: [],
      movedLineIds: ['l1'],
      templatePrices: { l1: 12.9 },
    }),
  };
  const quotesService = {
    findQuoteById: jest.fn().mockResolvedValue(q),
    updateQuote: jest.fn().mockResolvedValue(q),
  };
  const service = new QuoteCostCheckService(
    quotes as never,
    costing as never,
    quotesService as never,
  );
  return { service, quotes, quotesService };
}

describe('QuoteCostCheckService', () => {
  it('lists open quotes whose costs moved, with the margin then and now', async () => {
    const { service, quotes } = setup({ status: QuoteStatus.DRAFT });
    const [check] = await service.openQuotesWithMovedCosts(TENANT);
    expect(quotes.find.mock.calls[0][0].where).toMatchObject({
      tenantId: TENANT,
    });
    expect(check).toMatchObject({
      moved: true,
      savedCost: 4000,
      currentCost: 4300,
      subtotal: 6000,
      canReprice: true,
    });
    expect(check.savedMarginPct).toBeCloseTo(0.3333, 4);
    expect(check.currentMarginPct).toBeCloseTo(0.2833, 4);
    expect(check.repricedSubtotal).toBe(6450);
  });

  it('re-costs through the ordinary update, re-pricing template lines when asked', async () => {
    const { service, quotesService } = setup({ status: QuoteStatus.DRAFT });
    await service.recost(TENANT, 'q1', 'COSTS_AND_PRICES', 'u1');
    expect(quotesService.updateQuote).toHaveBeenCalledWith(
      TENANT,
      'q1',
      { items: [expect.objectContaining({ id: 'l1', unitPrice: 12.9 })] },
      'u1',
    );
  });

  it('keeps an approved quote at its price, and never touches an accepted one', async () => {
    const approved = setup({ status: QuoteStatus.APPROVED });
    await expect(
      approved.service.recost(TENANT, 'q1', 'COSTS_AND_PRICES', null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await approved.service.recost(TENANT, 'q1', 'COSTS', null);
    expect(approved.quotesService.updateQuote).toHaveBeenCalledWith(
      TENANT,
      'q1',
      { items: [line] },
      null,
    );

    const accepted = setup({
      status: QuoteStatus.APPROVED,
      acceptedAt: new Date(),
    });
    await expect(
      accepted.service.recost(TENANT, 'q1', 'COSTS', null),
    ).rejects.toThrow(/keeps the costs it was made with/);
    expect(accepted.quotesService.updateQuote).not.toHaveBeenCalled();
  });
});
