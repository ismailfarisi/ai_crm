import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { QuoteStatus } from './entities/quote.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';

function makeService(overrides: Record<string, unknown> = {}) {
  const quote: any = {
    id: 'q1',
    tenantId,
    quoteNumber: 'QT-2026-0001',
    title: 'Gift boxes',
    customerName: 'Acme',
    customerEmail: 'ap@acme.test',
    status: QuoteStatus.DRAFT,
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
  const service = new QuoteAcceptanceService(
    quotes,
    { findOne: jest.fn(async () => ({ name: 'Northside Print' })) } as any,
    { get: () => ['https://app.example.test'] } as any,
    events as any,
  );
  return { service, quote, events };
}

const tokenFrom = (url: string) => url.split('/q/')[1];

describe('QuoteAcceptanceService', () => {
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

  it('records acceptance once; the same link cannot accept again', async () => {
    const { service, quote, events } = makeService();
    const token = tokenFrom((await service.createLink(tenantId, 'q1')).url);

    await service.accept(token, { name: 'Jo Bloggs' }, '203.0.113.9');
    expect(quote.acceptedByName).toBe('Jo Bloggs');
    expect(events.handleCrmEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'quote.accepted' }),
    );
    // Acceptance is recorded, not acted on: approval stays internal.
    expect(quote.status).toBe(QuoteStatus.DRAFT);

    await expect(
      service.accept(token, { name: 'Someone Else' }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(quote.acceptedByName).toBe('Jo Bloggs');
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

  it('treats a malformed token as not found without querying', async () => {
    const { service } = makeService();
    await expect(service.view("' OR 1=1 --")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
