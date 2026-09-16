import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  PERMISSIONS,
  type GuardrailViolation,
  type Permission,
  type QuoteLineItem,
} from '@saas/shared';
import { Quote, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { QuotesService } from './quotes.service';
import { InvoicesService } from './invoices.service';
import { TemporalService } from '../temporal/temporal.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { CostingService } from '../catalog/costing.service';
import { RbacService } from '../rbac/rbac.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const quoteId = '22222222-2222-2222-2222-222222222222';
const approverId = '44444444-4444-4444-4444-444444444444';

const BELOW_FLOOR: GuardrailViolation = {
  code: 'MARGIN_BELOW_FLOOR',
  message: 'Margin is 4.0%, below the 20.0% floor',
  actual: 0.04,
  limit: 0.2,
};

/** What the browser posts, claiming a cost that makes a thin quote look fat. */
const SPOOFED_LINE: QuoteLineItem = {
  id: 'line-1',
  type: 'product',
  description: 'Rigid gift box',
  quantity: 500,
  unitPrice: 2.5,
  discount: 0,
  taxRate: 0,
  templateId: 'template-1',
  cost: { unitCost: 0.01, totalCost: 5, source: 'COMPUTED' },
};

/** What the catalog actually says the job costs. */
const TRUE_COST = {
  unitCost: 2.4,
  totalCost: 1200,
  source: 'COMPUTED' as const,
};

describe('QuotesService — margin guardrails', () => {
  let service: QuotesService;
  let quoteRepo: jest.Mocked<Partial<Repository<Quote>>>;
  let costingService: jest.Mocked<Partial<CostingService>>;
  let rbacService: jest.Mocked<Partial<RbacService>>;
  let storedQuote: Quote;

  const withPermissions = (permissions: Permission[]) => {
    rbacService.resolveAccess = jest.fn().mockResolvedValue({
      permissions,
      roles: ['manager'],
      level: 20,
      isOwner: false,
    });
  };

  const withViolations = (violations: GuardrailViolation[]) => {
    costingService.recostLines = jest
      .fn()
      .mockImplementation(async (_t, items: QuoteLineItem[]) => {
        // The service always replaces the client's cost with the catalog's.
        const recosted = items.map((item) =>
          item.type === 'product' && item.templateId
            ? { ...item, cost: TRUE_COST }
            : item,
        );
        return {
          items: recosted,
          totals: calculateQuoteTotals(recosted),
          violations,
          staleLineIds: [],
        };
      });
  };

  beforeEach(() => {
    storedQuote = {
      id: quoteId,
      tenantId,
      status: QuoteStatus.AWAITING_APPROVAL,
      items: [SPOOFED_LINE],
      workflowId: `quote-${quoteId}`,
      totalAmount: 1250,
    } as unknown as Quote;

    quoteRepo = {
      findOne: jest.fn().mockResolvedValue(storedQuote),
      create: jest.fn().mockImplementation((dto) => ({ id: quoteId, ...dto })),
      save: jest.fn().mockImplementation(async (quote) => quote),
      manager: {
        query: jest.fn().mockResolvedValue([{ current_value: 1 }]),
      } as never,
    };

    costingService = {};
    rbacService = {};
    withViolations([]);
    withPermissions([PERMISSIONS.QUOTE_APPROVE]);

    service = new QuotesService(
      quoteRepo as unknown as Repository<Quote>,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<Invoice>,
      {
        getClient: () => {
          throw new Error('Temporal unavailable');
        },
      } as unknown as TemporalService,
      {
        createFromQuote: jest.fn().mockResolvedValue({
          invoice: { id: 'inv-1' },
          invoicesRaised: [],
          isNew: false,
        }),
      } as unknown as InvoicesService,
      { handleCrmEvent: jest.fn() } as unknown as AutomationEventBridgeService,
      costingService as unknown as CostingService,
      rbacService as unknown as RbacService,
      {
        applyToLines: jest.fn(async (_t: string, items: unknown) => items),
      } as any,
      {
        notifyHolders: jest.fn(async () => 0),
        resolve: jest.fn(async () => undefined),
      } as any,
    );
  });

  /**
   * The load-bearing property. If a client-supplied cost survived the save,
   * every floor below it would be trivially clearable from the browser.
   */
  describe('client-supplied cost never survives', () => {
    it('replaces the posted cost on create', async () => {
      const created = await service.createQuote(tenantId, {
        title: 'Gift boxes',
        items: [SPOOFED_LINE],
      });

      expect(created.items[0].cost).toEqual(TRUE_COST);
      expect(created.items[0].cost?.totalCost).not.toBe(5);
    });

    it('replaces the posted cost on update', async () => {
      const updated = await service.updateQuote(tenantId, quoteId, {
        items: [SPOOFED_LINE],
      });

      expect(updated.items[0].cost).toEqual(TRUE_COST);
    });

    it('recomputes totals from the re-costed lines', async () => {
      const created = await service.createQuote(tenantId, {
        title: 'Gift boxes',
        items: [SPOOFED_LINE],
      });

      expect(created.subtotalAmount).toBe(1250);
      expect(created.totalAmount).toBe(1250);
    });
  });

  describe('approval', () => {
    it('goes through when nothing breaches policy', async () => {
      const result = await service.sendSignal(
        tenantId,
        quoteId,
        'APPROVE',
        undefined,
        approverId,
      );
      expect(result.status).toBe(QuoteStatus.APPROVED);
    });

    it('refuses a below-floor quote for an ordinary approver', async () => {
      withViolations([BELOW_FLOOR]);

      await expect(
        service.sendSignal(tenantId, quoteId, 'APPROVE', undefined, approverId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the reason, not just a 403', async () => {
      withViolations([BELOW_FLOOR]);

      try {
        await service.sendSignal(
          tenantId,
          quoteId,
          'APPROVE',
          undefined,
          approverId,
        );
        throw new Error('should have been refused');
      } catch (error) {
        const body = (error as ForbiddenException).getResponse() as {
          message: string;
          violations: GuardrailViolation[];
        };
        expect(body.message).toBe(BELOW_FLOOR.message);
        expect(body.violations).toEqual([BELOW_FLOOR]);
      }
    });

    it('lets an actor holding the override through', async () => {
      withViolations([BELOW_FLOOR]);
      withPermissions([
        PERMISSIONS.QUOTE_APPROVE,
        PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN,
      ]);

      const result = await service.sendSignal(
        tenantId,
        quoteId,
        'APPROVE',
        undefined,
        approverId,
      );
      expect(result.status).toBe(QuoteStatus.APPROVED);
    });

    /**
     * `quote:approve` alone is not the override — the whole point is that
     * being an approver does not make you a *discount* approver.
     */
    it('does not treat plain approve rights as the override', async () => {
      withViolations([BELOW_FLOOR]);
      withPermissions([PERMISSIONS.QUOTE_APPROVE, PERMISSIONS.QUOTE_VIEW_COST]);

      await expect(
        service.sendSignal(tenantId, quoteId, 'APPROVE', undefined, approverId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks the actor effective permissions, not their role level', async () => {
      withViolations([BELOW_FLOOR]);
      withPermissions([PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN]);

      await service.sendSignal(
        tenantId,
        quoteId,
        'APPROVE',
        undefined,
        approverId,
      );
      expect(rbacService.resolveAccess).toHaveBeenCalledWith(
        approverId,
        tenantId,
      );
    });

    // An automation must never be the thing that waives a commercial floor.
    it('refuses an unattributed approval when policy is breached', async () => {
      withViolations([BELOW_FLOOR]);

      await expect(
        service.sendSignal(tenantId, quoteId, 'APPROVE'),
      ).rejects.toThrow(ForbiddenException);
      expect(rbacService.resolveAccess).not.toHaveBeenCalled();
    });

    it('still lets an unattributed approval through when policy is clean', async () => {
      const result = await service.sendSignal(tenantId, quoteId, 'APPROVE');
      expect(result.status).toBe(QuoteStatus.APPROVED);
    });

    it('re-costs at approval, so a stale stored cost cannot be approved', async () => {
      await service.sendSignal(
        tenantId,
        quoteId,
        'APPROVE',
        undefined,
        approverId,
      );

      expect(costingService.recostLines).toHaveBeenCalledWith(tenantId, [
        SPOOFED_LINE,
      ]);
      expect(quoteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalAmount: 1250 }),
      );
    });

    it('never blocks a rejection', async () => {
      withViolations([BELOW_FLOOR]);
      withPermissions([]);

      const result = await service.sendSignal(
        tenantId,
        quoteId,
        'REJECT',
        'Too thin',
        approverId,
      );
      expect(result.status).toBe(QuoteStatus.REJECTED);
    });
  });

  /**
   * A rep has to be able to save and look at a thin quote before they can fix
   * it. The floor bites at approval, which is the commitment.
   */
  describe('drafting stays possible', () => {
    it('saves a below-floor draft without complaint', async () => {
      withViolations([BELOW_FLOOR]);
      withPermissions([]);

      const created = await service.createQuote(tenantId, {
        title: 'Thin quote',
        items: [SPOOFED_LINE],
      });
      expect(created.status).toBe(QuoteStatus.DRAFT);
    });

    it('reports what would block approval without changing anything', async () => {
      withViolations([BELOW_FLOOR]);

      const evaluation = await service.evaluateQuote(tenantId, quoteId);

      expect(evaluation.violations).toEqual([BELOW_FLOOR]);
      expect(evaluation.totals.costAmount).toBe(1200);
      expect(quoteRepo.save).not.toHaveBeenCalled();
    });
  });
});
