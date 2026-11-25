import { Reflector } from '@nestjs/core';
import { StreamableFile } from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { InvoicesService } from './invoices.service';
import { QuoteAcceptanceService } from './quote-acceptance.service';

describe('QuotesController', () => {
  let controller: QuotesController;
  let quotesService: jest.Mocked<Partial<QuotesService>>;
  let invoicesService: jest.Mocked<Partial<InvoicesService>>;
  let acceptanceService: jest.Mocked<Partial<QuoteAcceptanceService>>;
  const reflector = new Reflector();

  const user: AuthenticatedUser = {
    id: 'user-1',
    organizationId: 'org-111',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    roles: ['member'],
    level: 10,
    permissions: [],
    isOwner: false,
    teamId: null,
    managerId: null,
  };

  beforeEach(() => {
    quotesService = {
      getPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock quote pdf'),
        filename: 'QT-2026-0001.pdf',
      }),
    };
    invoicesService = {
      getPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock invoice pdf'),
        filename: 'INV-2026-0001.pdf',
      }),
    };
    acceptanceService = {};

    controller = new QuotesController(
      quotesService as QuotesService,
      invoicesService as InvoicesService,
      acceptanceService as QuoteAcceptanceService,
    );
  });

  describe('cost visibility', () => {
    const costedQuote = {
      id: 'q-1',
      items: [
        {
          id: 'line-1',
          type: 'product',
          description: 'Shop sign',
          quantity: 1,
          unitPrice: 900,
          discount: 0,
          subtotal: 900,
          cost: { unitCost: 693, totalCost: 693, source: 'QUICK' },
          quickCost: {
            materials: [],
            hours: [],
            boughtIn: [{ description: 'LED modules', amount: 120, per: 'job' }],
            overheadPct: 0.1,
            costedForQuantity: 1,
          },
        },
      ],
    };
    const rep = { ...user, permissions: [PERMISSIONS.QUOTE_READ] };
    const estimator = {
      ...user,
      permissions: [PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_VIEW_COST],
    };

    beforeEach(() => {
      quotesService.findQuoteById = jest
        .fn()
        .mockResolvedValue(structuredClone(costedQuote));
      quotesService.findAllQuotes = jest
        .fn()
        .mockResolvedValue([structuredClone(costedQuote)]);
      quotesService.updateQuote = jest
        .fn()
        .mockResolvedValue(structuredClone(costedQuote));
      quotesService.evaluateQuote = jest.fn().mockResolvedValue({
        totals: {
          subtotalAmount: 900,
          costAmount: 693,
          marginAmount: 207,
          marginPct: 0.23,
          hasCompleteCost: true,
        },
        violations: [
          {
            code: 'MARGIN_BELOW_FLOOR',
            message: 'Margin is 23.0%, below the 30.0% floor',
            actual: 0.23,
            limit: 0.3,
          },
        ],
      });
    });

    it('sends no line cost or quick costing without quote:view_cost', async () => {
      const one = await controller.findQuoteById(rep, 'q-1');
      const [listed] = await controller.findAllQuotes(rep);
      const saved = await controller.updateQuote(rep, 'q-1', {});
      for (const quote of [one, listed, saved]) {
        expect(quote.items[0]).not.toHaveProperty('cost');
        expect(quote.items[0]).not.toHaveProperty('quickCost');
        expect(quote.items[0].unitPrice).toBe(900);
      }
    });

    it('sends them to someone with quote:view_cost', async () => {
      const quote = await controller.findQuoteById(estimator, 'q-1');
      expect(quote.items[0].cost?.totalCost).toBe(693);
      expect(quote.items[0].quickCost?.boughtIn).toHaveLength(1);
    });

    it('tells the service whether the person saving was sent costs', async () => {
      await controller.updateQuote(rep, 'q-1', { title: 'x' });
      expect(quotesService.updateQuote).toHaveBeenLastCalledWith(
        'org-111',
        'q-1',
        { title: 'x' },
        'user-1',
        { canSeeCost: false },
      );
      await controller.updateQuote(estimator, 'q-1', { title: 'x' });
      expect(quotesService.updateQuote).toHaveBeenLastCalledWith(
        'org-111',
        'q-1',
        { title: 'x' },
        'user-1',
        { canSeeCost: true },
      );
    });

    it('hides cost and margin figures in the guardrail preview', async () => {
      const result = await controller.evaluateQuote(rep, 'q-1');
      expect(result.totals.costAmount).toBe(0);
      expect(result.totals.marginPct).toBe(0);
      expect(result.violations[0]).toMatchObject({ actual: 0, limit: 0 });
      expect(result.violations[0].message).not.toMatch(/23/);
    });
  });

  describe('GET /quotes/:id/pdf', () => {
    it('should protect downloadQuotePdf with PERMISSIONS.QUOTE_READ', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.downloadQuotePdf,
      );
      expect(perms).toEqual([PERMISSIONS.QUOTE_READ]);
    });

    it('should call quotesService.getPdf, set headers, and return StreamableFile', async () => {
      const mockRes = {
        set: jest.fn(),
      } as any;

      const file = await controller.downloadQuotePdf(
        user,
        'quote-123',
        mockRes,
      );

      expect(quotesService.getPdf).toHaveBeenCalledWith('org-111', 'quote-123');
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="QT-2026-0001.pdf"',
      });
      expect(file).toBeInstanceOf(StreamableFile);
    });
  });
});
