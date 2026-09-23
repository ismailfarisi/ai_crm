import { PERMISSIONS } from '@saas/shared';
import { SalesOrderFromDocumentSkill } from './sales-order-from-document.skill';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { QuoteCreatedBy } from '../../quotes/entities/quote.entity';
import type { QuotesService } from '../../quotes/quotes.service';
import type { OrdersService } from '../../orders/orders.service';
import type { SkillContext } from './skill.types';

describe('SalesOrderFromDocumentSkill', () => {
  let quotesService: jest.Mocked<Partial<QuotesService>>;
  let ordersService: jest.Mocked<Partial<OrdersService>>;
  let skill: SalesOrderFromDocumentSkill;

  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    provider: ChannelProviderType.EMAIL_RESEND,
    senderIdentifier: 'buyer@acme.com',
    permissions: [
      PERMISSIONS.SALES_ORDER_UPDATE,
      PERMISSIONS.QUOTE_CREATE,
      PERMISSIONS.QUOTE_APPROVE,
    ],
    message: 'Customer sent PO-9912 accepting quote QT-2026-0004',
  };

  beforeEach(() => {
    quotesService = {
      findAllQuotes: jest.fn(),
      findQuoteById: jest.fn(),
      createQuote: jest.fn(),
      sendSignal: jest.fn(),
    };
    ordersService = {
      findByQuote: jest.fn(),
    };
    skill = new SalesOrderFromDocumentSkill(
      quotesService as unknown as QuotesService,
      ordersService as unknown as OrdersService,
    );
  });

  it('matches an existing open quote referenced in PO text', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'DRAFT',
        customerName: 'Acme Corp',
        totalAmount: 3500,
        currency: 'USD',
        items: [{ id: 'item-1', description: 'Packaging', quantity: 500, unitPrice: 7 }],
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      { quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' },
      ctx,
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('MATCHED_QUOTE');
      expect(res.value.quoteNumber).toBe('QT-2026-0004');
      expect(res.value.customerPoNumber).toBe('PO-9912');
      expect(res.value.totalAmount).toBe(3500);
      expect(res.value.itemsCount).toBe(1);
    }
  });

  it('refuses if the quote already has an active sales order', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'APPROVED',
        customerName: 'Acme Corp',
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0001',
      status: 'OPEN',
    } as any);

    const res = await skill.resolve(
      { quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' },
      ctx,
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already has Sales Order SO-2026-0001');
    }
  });

  it('refuses if the quote is not in an approvable status', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'REJECTED',
        customerName: 'Acme Corp',
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      { quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' },
      ctx,
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already rejected');
    }
  });

  it('refuses if the quote number cannot be found', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve(
      { quoteNumber: 'QT-2026-9999', customerPoNumber: 'PO-9912' },
      { ...ctx, message: 'PO-9912 for QT-2026-9999' },
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain("couldn't find quote QT-2026-9999");
    }
  });

  it('matches open quote by customer name when single candidate exists', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-5',
        quoteNumber: 'QT-2026-0005',
        status: 'AWAITING_APPROVAL',
        customerName: 'Acme Corp',
        totalAmount: 1500,
        currency: 'USD',
        items: [{ id: 'i-1' }],
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      { customerName: 'Acme', customerPoNumber: 'PO-1234' },
      { ...ctx, message: 'Turn PO-1234 from Acme into an order' },
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('MATCHED_QUOTE');
      expect(res.value.quoteId).toBe('q-5');
      expect(res.value.quoteNumber).toBe('QT-2026-0005');
      expect(res.value.customerPoNumber).toBe('PO-1234');
    }
  });

  it('asks question when multiple open quotes exist for the customer', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0001',
        status: 'DRAFT',
        customerName: 'Acme Corp',
        totalAmount: 1000,
        currency: 'USD',
      } as any,
      {
        id: 'q-2',
        quoteNumber: 'QT-2026-0002',
        status: 'AWAITING_APPROVAL',
        customerName: 'Acme Corp',
        totalAmount: 2000,
        currency: 'USD',
      } as any,
    ]);

    const res = await skill.resolve(
      { customerName: 'Acme Corp', customerPoNumber: 'PO-8811' },
      { ...ctx, message: 'Customer PO-8811 from Acme Corp' },
    );
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toContain('QT-2026-0001');
      expect(res.question).toContain('QT-2026-0002');
    }
  });

  it('stages a new draft quote when customer sends PO without existing quote', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);
    quotesService.createQuote = jest.fn().mockResolvedValue({
      id: 'q-2',
      quoteNumber: 'QT-2026-0010',
      status: 'DRAFT',
      customerName: 'Brightline Ltd',
      totalAmount: 1200,
      currency: 'USD',
      items: [{ id: 'item-2', description: '100x Custom Folders', quantity: 100, unitPrice: 12 }],
    } as any);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      {
        customerName: 'Brightline Ltd',
        customerPoNumber: 'PO-5501',
        description: '100 custom folders',
      },
      { ...ctx, message: 'PO-5501 from Brightline Ltd for 100 custom folders' },
    );

    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('NEW_QUOTE');
      expect(res.value.customerName).toBe('Brightline Ltd');
      expect(res.value.customerPoNumber).toBe('PO-5501');
      expect(res.value.quoteId).toBe('q-2');
      expect(res.value.totalAmount).toBe(1200);
    }
    expect(quotesService.createQuote).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        title: expect.stringContaining('PO-5501'),
        customerEmail: 'buyer@acme.com',
      }),
    );
  });

  it('refuses staging new quote if lacking QUOTE_CREATE or QUOTE_APPROVE permission', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);

    const unpermittedCtx: SkillContext = {
      ...ctx,
      message: 'PO-3001 for New Client: Sample items',
      permissions: [PERMISSIONS.SALES_ORDER_UPDATE], // missing QUOTE_CREATE and QUOTE_APPROVE
    };

    const res = await skill.resolve(
      { customerName: 'New Client', customerPoNumber: 'PO-3001', description: 'Sample items' },
      unpermittedCtx,
    );

    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toBe(
        'Creating a new order requires permission to create and approve quotes.',
      );
    }
  });

  it('asks question when neither quote nor customer can be identified', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve({}, { ...ctx, message: 'here is a document' });
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toContain('quote number');
      expect(res.question).toContain('customer name');
    }
  });

  it('refuses if slot data is invalid', async () => {
    const res = await skill.resolve(
      { totalAmount: -500 },
      ctx,
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('could not make sense');
    }
  });

  it('generates confirmation preview and provisions sales order upon approval', async () => {
    const resolved = {
      mode: 'MATCHED_QUOTE' as const,
      quoteId: 'q-1',
      quoteNumber: 'QT-2026-0004',
      customerPoNumber: 'PO-9912',
      customerName: 'Acme Corp',
      totalAmount: 3500,
      currency: 'USD',
      itemsCount: 1,
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('PO-9912');
    expect(preview).toContain('QT-2026-0004');
    expect(preview).toContain('Acme Corp');
    expect(preview).toContain('3500 USD');
    expect(preview).toContain('Reply YES to confirm or NO to cancel.');

    quotesService.sendSignal = jest.fn().mockResolvedValue({ id: 'q-1', quoteNumber: 'QT-2026-0004' } as any);
    ordersService.findByQuote = jest.fn().mockResolvedValue({ id: 'so-1', orderNumber: 'SO-2026-0009' } as any);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('SALES_ORDER');
    expect(outcome.resultId).toBe('so-1');
    expect(outcome.reply).toContain('SO-2026-0009');
    expect(quotesService.sendSignal).toHaveBeenCalledWith('org-1', 'q-1', 'APPROVE');
    expect(ordersService.findByQuote).toHaveBeenCalledWith('org-1', 'q-1');
  });

  it('handles execute fallback when findByQuote returns null', async () => {
    const resolved = {
      mode: 'NEW_QUOTE' as const,
      quoteId: 'q-2',
      quoteNumber: 'QT-2026-0010',
      customerPoNumber: 'PO-5501',
      customerName: 'Brightline Ltd',
      totalAmount: 1200,
      currency: 'USD',
      itemsCount: 2,
    };

    quotesService.sendSignal = jest.fn().mockResolvedValue({ id: 'q-2', quoteNumber: 'QT-2026-0010' } as any);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('SALES_ORDER');
    expect(outcome.resultId).toBe('q-2');
    expect(outcome.reply).toContain('(provisioned)');
  });

  it('ignores cancelled existing order and allows quote matching', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'DRAFT',
        customerName: 'Acme Corp',
        totalAmount: 3500,
        currency: 'USD',
        items: [],
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue({
      id: 'so-old',
      orderNumber: 'SO-2026-0000',
      status: 'CANCELLED',
    } as any);

    const res = await skill.resolve(
      { quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' },
      ctx,
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('MATCHED_QUOTE');
    }
  });

  it('refuses customer name match if the matched quote already has an active order', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'DRAFT',
        customerName: 'Acme Corp',
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0001',
      status: 'OPEN',
    } as any);

    const res = await skill.resolve(
      { customerName: 'Acme Corp', customerPoNumber: 'PO-9912' },
      { ...ctx, message: 'Turn PO-9912 from Acme Corp into an order' },
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already has Sales Order SO-2026-0001');
    }
  });

  it('generates confirmation preview for NEW_QUOTE mode', async () => {
    const resolved = {
      mode: 'NEW_QUOTE' as const,
      quoteId: 'q-2',
      quoteNumber: 'QT-2026-0010',
      customerPoNumber: 'PO-5501',
      customerName: 'Brightline Ltd',
      totalAmount: 1200,
      currency: 'USD',
      itemsCount: 2,
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('Create and provision Sales Order');
    expect(preview).toContain('PO-5501');
    expect(preview).toContain('Brightline Ltd');
    expect(preview).toContain('QT-2026-0010');
    expect(preview).toContain('1200 USD (2 line items)');
    expect(preview).toContain('Reply YES to confirm or NO to cancel.');
  });

  it('extracts PO reference with hash and spaces from message', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'DRAFT',
        customerName: 'Acme Corp',
        totalAmount: 3500,
        currency: 'USD',
        items: [],
      } as any,
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      {},
      {
        ...ctx,
        message: 'customer sent PO #4551 for quote QT-2026-0004',
      },
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.customerPoNumber).toBe('PO #4551');
      expect(res.value.quoteNumber).toBe('QT-2026-0004');
    }
  });

  it('sets customerEmail to undefined when senderIdentifier is not an email', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);
    quotesService.createQuote = jest.fn().mockResolvedValue({
      id: 'q-3',
      quoteNumber: 'QT-2026-0011',
      status: 'DRAFT',
      customerName: 'WhatsApp Client',
      totalAmount: 500,
      currency: 'USD',
      items: [],
    } as any);

    const whatsappCtx: SkillContext = {
      ...ctx,
      provider: ChannelProviderType.WHATSAPP_META,
      senderIdentifier: '+1234567890',
      message: 'PO-7700 for WhatsApp Client: widgets',
    };

    await skill.resolve(
      { customerName: 'WhatsApp Client', customerPoNumber: 'PO-7700', description: 'widgets' },
      whatsappCtx,
    );

    expect(quotesService.createQuote).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        customerEmail: undefined,
      }),
    );
  });

  it('uses customerEmail from validated slots and sets createdBy to QuoteCreatedBy.AI', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);
    quotesService.createQuote = jest.fn().mockResolvedValue({
      id: 'q-4',
      quoteNumber: 'QT-2026-0012',
      status: 'DRAFT',
      customerName: 'New Corp',
      totalAmount: 800,
      currency: 'USD',
      items: [],
    } as any);

    await skill.resolve(
      {
        customerName: 'New Corp',
        customerPoNumber: 'PO-9900',
        customerEmail: 'billing@newcorp.com',
        description: 'supplies',
      },
      { ...ctx, message: 'PO-9900 from New Corp for supplies' },
    );

    expect(quotesService.createQuote).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        customerEmail: 'billing@newcorp.com',
        createdBy: QuoteCreatedBy.AI,
      }),
    );
  });
});

