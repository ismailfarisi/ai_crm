import { changesCommercialTerms } from './quotes.service';
import type { Quote } from './entities/quote.entity';

const quote = {
  items: [
    {
      id: 'l1',
      type: 'product',
      description: 'Boxes',
      quantity: 100,
      unitPrice: 2,
      taxRate: 20,
      subtotal: 200,
      cost: { unitCost: 0.5, totalCost: 50, source: 'COMPUTED' },
    },
  ],
  billingSchedule: null,
  currency: 'GBP',
  paymentTerms: 'net_30',
  validUntil: new Date('2026-10-01T00:00:00Z'),
  termsAndConditions: 'Standard terms',
  customerId: null,
  customerName: 'Acme',
} as unknown as Quote;

describe('changesCommercialTerms', () => {
  it('treats the editor re-sending identical values as no change', () => {
    // The editor sends every field on every save, with cost stripped.
    expect(
      changesCommercialTerms(quote, {
        title: 'Renamed internally',
        notes: 'Internal note',
        items: [{ ...quote.items[0], cost: undefined, subtotal: 200 }],
        billingSchedule: [
          {
            kind: 'FINAL',
            label: 'Full amount',
            percent: 100,
            trigger: 'ON_APPROVAL',
          },
        ],
        currency: 'GBP',
        paymentTerms: 'net_30',
        validUntil: '2026-10-01',
        termsAndConditions: 'Standard terms',
        customerId: null,
        customerName: 'Acme',
      }),
    ).toBe(false);
  });

  it('sees a price change', () => {
    expect(
      changesCommercialTerms(quote, {
        items: [{ ...quote.items[0], unitPrice: 1.9 }],
      }),
    ).toBe(true);
  });

  it('sees a new billing schedule', () => {
    expect(
      changesCommercialTerms(quote, {
        billingSchedule: [
          {
            kind: 'DEPOSIT',
            label: 'Deposit',
            percent: 50,
            trigger: 'ON_APPROVAL',
          },
          { kind: 'FINAL', label: 'Balance', percent: 50, trigger: 'MANUAL' },
        ],
      }),
    ).toBe(true);
  });

  it('sees changed terms and a changed expiry', () => {
    expect(
      changesCommercialTerms(quote, { termsAndConditions: 'New terms' }),
    ).toBe(true);
    expect(changesCommercialTerms(quote, { validUntil: '2026-12-01' })).toBe(
      true,
    );
  });
});
