import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { QuoteStatus } from './entities/quote.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';

function makeService(
  overrides: Record<string, unknown> = {},
  deps: { proofs?: any; audit?: any } = {},
) {
  const quote: any = {
    id: 'q1',
    tenantId,
    quoteNumber: 'QT-2026-0001',
    title: 'Gift boxes',
    customerName: 'Acme',
    customerEmail: 'ap@acme.test',
    status: QuoteStatus.APPROVED,
    currency: 'GBP',
    paymentTerms: 'net_30',
    termsAndConditions: null,
    notes: 'Internal: they always haggle',
    validUntil: null,
    items: [
      {
        id: 'l1',
        type: 'product',
        description: 'Boxes',
        quantity: 100,
        unitPrice: 2,
        subtotal: 200,
        cost: { unitCost: 0.5, totalCost: 50, source: 'COMPUTED' },
      },
    ],
    subtotalAmount: 200,
    discountAmount: 0,
    taxAmount: 40,
    totalAmount: 240,
    billingSchedule: null,
    acceptanceTokenHash: null,
    acceptanceExpiresAt: null,
    acceptedAt: null,
    acceptedByName: null,
    supersededAt: null,
    ...overrides,
  };

  const quotes: any = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return where.id === quote.id ? quote : null;
      return where.acceptanceTokenHash === quote.acceptanceTokenHash
        ? quote
        : null;
    }),
    update: jest.fn(async (_where: any, patch: any) =>
      Object.assign(quote, patch),
    ),
    // No order or deposit invoice yet unless a test adds them.
    manager: {
      getRepository: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
    },
    createQueryBuilder: jest.fn(() => {
      let patch: any;
      const qb: any = {
        update: () => qb,
        set: (p: any) => {
          patch = p;
          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        // The real statement only matches while accepted_at IS NULL.
        execute: async () => {
          if (quote.acceptedAt) return { affected: 0 };
          Object.assign(quote, patch);
          return { affected: 1 };
        },
      };
      return qb;
    }),
  };
  const events = { handleCrmEvent: jest.fn() };
  const quotesService = { provisionAcceptedQuote: jest.fn(async () => true) };
  const service = new QuoteAcceptanceService(
    quotes,
    { findOne: jest.fn(async () => ({ name: 'Northside Print' })) } as any,
    { get: () => ['https://app.example.test'] } as any,
    events as any,
    undefined as any,
    undefined,
    quotesService as any,
    deps.proofs,
    deps.audit,
  );
  return { service, quote, quotes, events, quotesService };
}

const tokenFrom = (url: string) => url.split('/q/')[1];

describe('QuoteAcceptanceService', () => {
  it('will not accept while the proof rule is unmet, and says why', async () => {
    const proofs = {
      isRequired: jest.fn(async () => true),
      blocksAcceptance: jest.fn(async () => true),
      forPublic: jest.fn(async () => []),
    };
    const { service, quote, quotesService } = makeService({}, { proofs });
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    const view = await service.view(token);
    expect(view.proofBlocksAcceptance).toBe(true);
    await expect(service.accept(token, { name: 'Jo Bloggs' }, undefined)).rejects.toMatchObject({
      response: { reason: 'PROOF_NOT_APPROVED' },
    });
    expect(quote.acceptedAt).toBeNull();
    expect(quotesService.provisionAcceptedQuote).not.toHaveBeenCalled();
  });

  it('audits a link acceptance under the customer name', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const { service } = makeService({}, { audit });
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    await service.accept(token, { name: 'Jo Bloggs' }, '203.0.113.9');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.customer_accept',
        actorName: 'Jo Bloggs (customer)',
        subjectId: 'q1',
      }),
    );
  });

  it('clears an earlier decline when the quote is sent again', async () => {
    const { service, quote } = makeService({
      customerResponse: 'DECLINED',
      customerResponseNote: 'Too dear',
    });
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    expect(quote.customerResponse).toBeNull();
    await expect(service.view(token)).resolves.toMatchObject({ customerResponse: null });
  });

  it('stores only a hash of the token', async () => {
    const { service, quote } = makeService();
    const { url } = await service.createLink(tenantId, 'q1');
    const token = tokenFrom(url);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(quote.acceptanceTokenHash).toHaveLength(64);
    expect(quote.acceptanceTokenHash).not.toContain(token);
  });

  it('shows the customer prices but never cost or internal notes', async () => {
    const { service } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    const view = await service.view(token);
    const wire = JSON.stringify(view);

    expect(view.totalAmount).toBe(240);
    expect(view.organizationName).toBe('Northside Print');
    expect(wire).not.toMatch(/cost|haggle/i);
  });

  it('records acceptance once and raises the order; the same link cannot accept again', async () => {
    const { service, quote, events, quotesService } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    await service.accept(token, { name: 'Jo Bloggs' }, '203.0.113.9');
    expect(quote.acceptedByName).toBe('Jo Bloggs');
    expect(events.handleCrmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'quote.accepted' }),
    );
    expect(quotesService.provisionAcceptedQuote).toHaveBeenCalledWith(
      tenantId,
      'q1',
    );

    await expect(
      service.accept(token, { name: 'Someone Else' }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(quote.acceptedByName).toBe('Jo Bloggs');
  });

  it('shows the deposit invoice raised on acceptance, and its balance', async () => {
    const { service, quotes } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);
    await service.accept(token, { name: 'Jo Bloggs' }, undefined);

    const rows: Record<string, unknown> = {
      SalesOrder: { id: 'so1' },
      BillingScheduleLine: {
        kind: 'DEPOSIT',
        invoiceId: 'inv1',
        label: '30% deposit',
      },
      Invoice: {
        id: 'inv1',
        tenantId,
        status: 'ISSUED',
        invoiceNumber: 'INV-0001',
        stageLabel: '30% deposit',
        amount: 72,
        paidAmount: 20,
        creditedAmount: 0,
        refundedAmount: 0,
      },
      PaymentSettings: null,
    };
    quotes.manager.getRepository.mockImplementation(
      (entity: { name: string }) => ({
        findOne: jest.fn(async () => rows[entity.name] ?? null),
      }),
    );

    expect((await service.view(token)).deposit).toEqual({
      label: '30% deposit',
      invoiceNumber: 'INV-0001',
      amount: 72,
      balanceDue: 52,
      paid: false,
      // Payment settings were never saved.
      canPayOnline: false,
    });
  });

  it('refuses an expired link', async () => {
    const { service, quote } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);
    quote.acceptanceExpiresAt = new Date(Date.now() - 1000);

    await expect(
      service.accept(token, { name: 'Jo Bloggs' }, undefined),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('refuses a link to a quote that has since been revised', async () => {
    const { service, quote } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);
    quote.supersededAt = new Date();

    await expect(service.view(token)).rejects.toBeInstanceOf(GoneException);
  });

  it('will not send a quote that has not been approved', async () => {
    const { service, quote } = makeService({ status: QuoteStatus.DRAFT });

    await expect(service.createLink(tenantId, 'q1')).rejects.toThrow(
      /Approve QT-2026-0001 before sending it/,
    );
    expect(quote.acceptanceTokenHash).toBeNull();
  });

  // The customer still said yes even if their order fails to appear.
  it('keeps the acceptance when the order cannot be raised', async () => {
    const { service, quote, quotesService } = makeService();
    quotesService.provisionAcceptedQuote.mockRejectedValueOnce(
      new Error('no FX rate'),
    );
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    await expect(
      service.accept(token, { name: 'Jo Bloggs' }, undefined),
    ).resolves.toMatchObject({ acceptedByName: 'Jo Bloggs' });
    expect(quote.acceptedAt).toBeInstanceOf(Date);
  });

  describe('markAccepted', () => {
    it('records an acceptance given another way and raises the order', async () => {
      const { service, quote, events, quotesService } = makeService();

      await service.markAccepted(tenantId, 'q1', 'Fatima (signed PO)');

      expect(quote.acceptedByName).toBe('Fatima (signed PO)');
      expect(events.handleCrmEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'quote.accepted' }),
      );
      expect(quotesService.provisionAcceptedQuote).toHaveBeenCalledWith(
        tenantId,
        'q1',
      );
    });

    it('refuses a quote that is not approved, or already accepted', async () => {
      const draft = makeService({ status: QuoteStatus.DRAFT });
      await expect(
        draft.service.markAccepted(tenantId, 'q1', 'Fatima'),
      ).rejects.toThrow(/must be approved/);
      expect(draft.quotesService.provisionAcceptedQuote).not.toHaveBeenCalled();

      const accepted = makeService({ acceptedAt: new Date() });
      await expect(
        accepted.service.markAccepted(tenantId, 'q1', 'Fatima'),
      ).rejects.toThrow(/already been accepted/);
    });
  });

  it('treats a malformed token as not found without querying', async () => {
    const { service } = makeService();
    await expect(service.view("' OR 1=1 --")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
