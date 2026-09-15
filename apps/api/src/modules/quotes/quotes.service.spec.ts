import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { QuotesService } from './quotes.service';
import { InvoicesService } from './invoices.service';
import { TemporalService } from '../temporal/temporal.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { CostingService } from '../catalog/costing.service';
import { RbacService } from '../rbac/rbac.service';
import {
  calculateQuoteTotals,
  CreateQuotePayload,
  PERMISSIONS,
  QuoteLineItem,
  UpdateQuotePayload,
} from '@saas/shared';

describe('QuotesService', () => {
  let service: QuotesService;
  let quoteRepo: jest.Mocked<Partial<Repository<Quote>>>;
  let invoiceRepo: jest.Mocked<Partial<Repository<Invoice>>>;
  let temporalService: jest.Mocked<Partial<TemporalService>>;
  let invoicesService: jest.Mocked<Partial<InvoicesService>>;
  let automationEventBridgeService: jest.Mocked<
    Partial<AutomationEventBridgeService>
  >;
  let costingService: jest.Mocked<Partial<CostingService>>;
  let rbacService: jest.Mocked<Partial<RbacService>>;
  let mockWorkflowHandle: any;
  let sequenceValue: number;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const quoteId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    mockWorkflowHandle = {
      workflowId: `quote-${quoteId}`,
      signal: jest.fn().mockResolvedValue(undefined),
    };

    sequenceValue = 0;
    quoteRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({
        id: quoteId,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (quote) => ({
        id: quoteId,
        ...quote,
      })),
      manager: {
        // Mimics the real allocate (INSERT ... RETURNING, increments) vs.
        // peek (SELECT, non-mutating) split in tenant-sequence.util.ts.
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.trim().toUpperCase().startsWith('INSERT')) {
            sequenceValue += 1;
            return [{ current_value: sequenceValue }];
          }
          return sequenceValue > 0 ? [{ current_value: sequenceValue }] : [];
        }),
      } as any,
    };

    invoiceRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    temporalService = {
      getClient: jest.fn().mockReturnValue({
        workflow: {
          start: jest.fn().mockResolvedValue(mockWorkflowHandle),
          getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
        },
      } as any),
    };

    invoicesService = {
      createFromQuote: jest.fn().mockResolvedValue({
        invoice: { id: 'invoice-1', invoiceNumber: 'INV-2026-0001' } as Invoice,
        invoicesRaised: [],
        isNew: false,
      }),
    };

    automationEventBridgeService = {
      handleCrmEvent: jest.fn().mockResolvedValue([]),
    };

    // Default: lines pass through unchanged and nothing breaches policy, so
    // the existing expectations still describe the same behaviour.
    costingService = {
      recostLines: jest.fn().mockImplementation(async (_tenantId, items) => ({
        items,
        totals: calculateQuoteTotals(items),
        violations: [],
        staleLineIds: [],
      })),
    };
    rbacService = {
      resolveAccess: jest.fn().mockResolvedValue({
        permissions: [PERMISSIONS.QUOTE_APPROVE],
        roles: ['manager'],
        level: 20,
        isOwner: false,
      }),
    };

    service = new QuotesService(
      quoteRepo as unknown as Repository<Quote>,
      invoiceRepo as unknown as Repository<Invoice>,
      temporalService as unknown as TemporalService,
      invoicesService as unknown as InvoicesService,
      automationEventBridgeService as unknown as AutomationEventBridgeService,
      costingService as unknown as CostingService,
      rbacService as unknown as RbacService,
    );
  });

  describe('generateNextQuoteNumber', () => {
    it('generates QT-YYYY-0001 for the first quote of the tenant', async () => {
      const nextNumber = await service.generateNextQuoteNumber(tenantId);
      const year = new Date().getFullYear();
      expect(nextNumber).toBe(`QT-${year}-0001`);
      expect(quoteRepo.manager!.query).toHaveBeenCalled();
    });

    it('generates sequential padded number based on the current sequence value', async () => {
      sequenceValue = 41;
      const nextNumber = await service.generateNextQuoteNumber(tenantId);
      const year = new Date().getFullYear();
      expect(nextNumber).toBe(`QT-${year}-0042`);
    });
  });

  describe('peekNextQuoteNumber', () => {
    it('previews the next number without mutating state observably differently from allocate', async () => {
      sequenceValue = 4;
      const nextNumber = await service.peekNextQuoteNumber(tenantId);
      const year = new Date().getFullYear();
      expect(nextNumber).toBe(`QT-${year}-0005`);
    });
  });

  describe('createQuote', () => {
    const sampleItems: QuoteLineItem[] = [
      {
        id: 'item-1',
        type: 'product',
        description: 'Web Development',
        quantity: 10,
        unitPrice: 100,
        discount: 10, // 10% discount on 1000 = 100 discount, net 900
        taxRate: 20, // 20% tax on 900 = 180 tax, total = 1080
      },
    ];

    it('creates quote with auto-generated quote number and calculated totals', async () => {
      sequenceValue = 2;

      const payload: CreateQuotePayload = {
        title: 'Project Alpha Proposal',
        customerId: '33333333-3333-3333-3333-333333333333',
        customerName: 'Acme International',
        customerEmail: 'billing@acme.com',
        paymentTerms: 'net_30',
        currency: 'USD',
        validUntil: '2026-12-31T00:00:00.000Z',
        termsAndConditions: 'Standard 30-day payment term.',
        notes: 'Priority client.',
        items: sampleItems,
      };

      const result = await service.createQuote(tenantId, payload);

      const year = new Date().getFullYear();
      expect(quoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          quoteNumber: `QT-${year}-0003`,
          title: 'Project Alpha Proposal',
          customerId: '33333333-3333-3333-3333-333333333333',
          customerName: 'Acme International',
          customerEmail: 'billing@acme.com',
          paymentTerms: 'net_30',
          currency: 'USD',
          validUntil: new Date('2026-12-31T00:00:00.000Z'),
          termsAndConditions: 'Standard 30-day payment term.',
          notes: 'Priority client.',
          subtotalAmount: 900,
          discountAmount: 100,
          taxAmount: 180,
          totalAmount: 1080,
          status: QuoteStatus.DRAFT,
          createdBy: QuoteCreatedBy.HUMAN,
        }),
      );

      expect(result.workflowId).toBe(`quote-${quoteId}`);
    });

    it('preserves custom quoteNumber if provided in payload', async () => {
      const payload: CreateQuotePayload = {
        title: 'Custom Number Quote',
        quoteNumber: 'CUSTOM-2026-99',
        items: [],
      };

      await service.createQuote(tenantId, payload);

      expect(quoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteNumber: 'CUSTOM-2026-99',
        }),
      );
      expect(quoteRepo.manager!.query).not.toHaveBeenCalled();
    });

    it('handles Temporal start errors gracefully and falls back to deterministic workflowId', async () => {
      temporalService.getClient = jest.fn().mockReturnValue({
        workflow: {
          start: jest.fn().mockRejectedValue(new Error('Temporal unavailable')),
        },
      } as any);

      const payload: CreateQuotePayload = {
        title: 'Offline Quote',
        items: [],
      };

      const result = await service.createQuote(tenantId, payload);
      expect(result.workflowId).toBe(`quote-${quoteId}`);
      expect(quoteRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateQuote', () => {
    it('updates fields and recalculates totals when items are updated', async () => {
      const existingQuote = {
        id: quoteId,
        tenantId,
        quoteNumber: 'QT-2026-0001',
        title: 'Original Title',
        customerName: 'Original Customer',
        subtotalAmount: 100,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 100,
        items: [],
        status: QuoteStatus.DRAFT,
      } as Quote;

      quoteRepo.findOne = jest.fn().mockResolvedValue({ ...existingQuote });

      const updatedItems: QuoteLineItem[] = [
        {
          id: 'item-new',
          type: 'product',
          description: 'Consulting',
          quantity: 2,
          unitPrice: 500,
          discount: 0,
          taxRate: 10, // 10% on 1000 = 100
        },
      ];

      const updatePayload: UpdateQuotePayload = {
        title: 'Updated Title',
        items: updatedItems,
      };

      const updated = await service.updateQuote(
        tenantId,
        quoteId,
        updatePayload,
      );

      expect(quoteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated Title',
          items: updatedItems,
          subtotalAmount: 1000,
          discountAmount: 0,
          taxAmount: 100,
          totalAmount: 1100,
        }),
      );
      expect(updated.title).toBe('Updated Title');
    });

    it('updates fields without changing totals when items are not provided', async () => {
      const existingQuote = {
        id: quoteId,
        tenantId,
        quoteNumber: 'QT-2026-0001',
        title: 'Original Title',
        subtotalAmount: 500,
        discountAmount: 50,
        taxAmount: 45,
        totalAmount: 495,
        items: [
          {
            id: '1',
            type: 'product',
            description: 'Item 1',
            quantity: 1,
            unitPrice: 500,
            discount: 10,
            taxRate: 10,
          },
        ],
      } as Quote;

      quoteRepo.findOne = jest.fn().mockResolvedValue({ ...existingQuote });

      await service.updateQuote(tenantId, quoteId, { title: 'New Title Only' });

      expect(quoteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Title Only',
          subtotalAmount: 500,
          discountAmount: 50,
          taxAmount: 45,
          totalAmount: 495,
        }),
      );
    });

    it('throws NotFoundException when quote does not exist', async () => {
      quoteRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateQuote(tenantId, 'non-existent', { title: 'Test' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findQuoteById', () => {
    it('returns quote when found', async () => {
      const existing = { id: quoteId, tenantId, title: 'Found Quote' } as Quote;
      quoteRepo.findOne = jest.fn().mockResolvedValue(existing);

      const res = await service.findQuoteById(tenantId, quoteId);
      expect(res).toBe(existing);
      expect(quoteRepo.findOne).toHaveBeenCalledWith({
        where: { id: quoteId, tenantId },
      });
    });

    it('throws NotFoundException when quote is not found', async () => {
      quoteRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.findQuoteById(tenantId, quoteId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllQuotes', () => {
    it('returns quotes ordered by createdAt DESC', async () => {
      const quotes = [{ id: '1' }, { id: '2' }] as Quote[];
      quoteRepo.find = jest.fn().mockResolvedValue(quotes);

      const res = await service.findAllQuotes(tenantId);
      expect(res).toBe(quotes);
      expect(quoteRepo.find).toHaveBeenCalledWith({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('sendSignal', () => {
    it('signals APPROVE and updates quote status to APPROVED', async () => {
      const existing = {
        id: quoteId,
        tenantId,
        status: QuoteStatus.DRAFT,
        workflowId: `quote-${quoteId}`,
      } as Quote;
      quoteRepo.findOne = jest.fn().mockResolvedValue({ ...existing });

      const res = await service.sendSignal(tenantId, quoteId, 'APPROVE');
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
      expect(quoteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: QuoteStatus.APPROVED }),
      );
      expect(res.status).toBe(QuoteStatus.APPROVED);
      // Default mock resolves isNew: false — no event should fire.
      expect(
        automationEventBridgeService.handleCrmEvent,
      ).not.toHaveBeenCalled();
    });

    it('emits invoice.issued for each invoice approval actually raised', async () => {
      const existing = {
        id: quoteId,
        tenantId,
        status: QuoteStatus.DRAFT,
        workflowId: `quote-${quoteId}`,
      } as Quote;
      quoteRepo.findOne = jest.fn().mockResolvedValue({ ...existing });
      invoicesService.createFromQuote = jest.fn().mockResolvedValue({
        invoice: { id: 'invoice-2', invoiceNumber: 'INV-2026-0002' } as Invoice,
        invoicesRaised: [
          { id: 'invoice-2', invoiceNumber: 'INV-2026-0002' } as Invoice,
        ],
        isNew: true,
      });

      await service.sendSignal(tenantId, quoteId, 'APPROVE');

      expect(automationEventBridgeService.handleCrmEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          eventType: 'invoice.issued',
          entityId: 'invoice-2',
        }),
      );
    });

    it('signals REJECT and updates quote status to REJECTED', async () => {
      const existing = {
        id: quoteId,
        tenantId,
        status: QuoteStatus.DRAFT,
        workflowId: `quote-${quoteId}`,
      } as Quote;
      quoteRepo.findOne = jest.fn().mockResolvedValue({ ...existing });

      const res = await service.sendSignal(tenantId, quoteId, 'REJECT', {
        reason: 'Price too high',
      });
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
      expect(quoteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: QuoteStatus.REJECTED }),
      );
      expect(res.status).toBe(QuoteStatus.REJECTED);
    });

    it('throws BadRequestException on invalid action', async () => {
      const existing = {
        id: quoteId,
        tenantId,
        status: QuoteStatus.DRAFT,
      } as Quote;
      quoteRepo.findOne = jest.fn().mockResolvedValue(existing);

      await expect(
        service.sendSignal(tenantId, quoteId, 'INVALID' as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
