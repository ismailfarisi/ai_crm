import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicQuoteDto } from '@saas/shared';
import { PublicQuoteView } from './public-quote-view';

const quote = (overrides: Partial<PublicQuoteDto> = {}): PublicQuoteDto => ({
  language: 'en',
  organizationName: 'Meridian Packaging',
  seller: {
    legalName: null,
    legalNameAr: 'ميريديان للتغليف',
    taxId: '100234567800003',
    registrationNumber: null,
    email: null,
    phone: null,
    website: null,
    addressLines: ['Al Quoz 3, Dubai'],
    addressAr: 'القوز 3، دبي',
    documentFooter: null,
    logoUrl: null,
  },
  quoteNumber: 'Q-2026-0107',
  title: 'Gift boxes',
  customerName: 'Al Noor Sweets',
  customerNameAr: 'حلويات النور',
  currency: 'AED',
  validUntil: null,
  paymentTerms: 'NET_30',
  termsAndConditions: null,
  items: [
    {
      description: 'Rigid gift box',
      descriptionAr: 'صندوق هدايا صلب',
      quantity: 500,
      uom: 'pcs',
      unitPrice: 12.5,
      discount: 0,
      taxRate: 5,
      subtotal: 6250,
    },
  ],
  subtotalAmount: 6250,
  discountAmount: 0,
  taxAmount: 312.5,
  totalAmount: 6562.5,
  billingSchedule: [{ label: 'On acceptance', percent: 100, totalAmount: 6562.5 }],
  acceptedAt: null,
  acceptedByName: null,
  ...overrides,
});

const serve = (body: PublicQuoteDto) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('PublicQuoteView', () => {
  it('shows an English quote left to right without Arabic', async () => {
    serve(quote());
    render(<PublicQuoteView token="t" />);
    expect(await screen.findByText('Rigid gift box')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByText('صندوق هدايا صلب')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept quote' })).toBeInTheDocument();
  });

  it('shows an Arabic quote right to left in Arabic', async () => {
    serve(quote({ language: 'ar' }));
    render(<PublicQuoteView token="t" />);
    expect(await screen.findByText('صندوق هدايا صلب')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByText('Rigid gift box')).not.toBeInTheDocument();
    expect(screen.getByText('ميريديان للتغليف')).toBeInTheDocument();
    expect(screen.getByText('الإجمالي')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'قبول عرض السعر' })).toBeInTheDocument();
  });

  it('shows both languages on a bilingual quote', async () => {
    serve(quote({ language: 'bilingual' }));
    render(<PublicQuoteView token="t" />);
    expect(await screen.findByText('Rigid gift box')).toBeInTheDocument();
    expect(screen.getByText('صندوق هدايا صلب')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('Total / الإجمالي')).toBeInTheDocument();
  });
});
