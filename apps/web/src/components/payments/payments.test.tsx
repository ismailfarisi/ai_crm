import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PublicDepositDto, PublicInvoiceDto } from '@saas/shared';
import { PublicInvoiceView } from './public-invoice-view';
import { TestCheckout } from './test-checkout';
import { DepositPanel } from './deposit-panel';

const invoice = (overrides: Partial<PublicInvoiceDto> = {}): PublicInvoiceDto => ({
  organizationName: 'Northwind Print',
  sellerTaxId: '100000000000003',
  sellerEmail: 'accounts@northwind.test',
  invoiceNumber: 'INV-2026-0007',
  stageLabel: null,
  customerName: 'Al Noor Sweets',
  currency: 'AED',
  issuedAt: '2026-11-01T00:00:00Z',
  dueDate: null,
  paymentTerms: null,
  status: 'ISSUED',
  items: [{ description: 'Gift boxes', quantity: 500, unitPrice: 4, subtotal: 2000 }],
  subtotalAmount: 2000,
  discountAmount: 0,
  taxAmount: 100,
  totalAmount: 2100,
  paidAmount: 0,
  creditedAmount: 0,
  balanceDue: 2100,
  canPayOnline: true,
  ...overrides,
});

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign, origin: 'http://localhost:3000', search: '' },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('PublicInvoiceView', () => {
  it('shows the balance and sends the customer to checkout', async () => {
    fetchMock
      .mockImplementationOnce(() => respond(invoice()))
      .mockImplementationOnce(() => respond({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    render(<PublicInvoiceView token="tok" justPaid={false} />);

    fireEvent.click(await screen.findByRole('button', { name: /Pay 2,100.00 AED/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'));
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/public\/payments\/invoices\/tok\/checkout$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'omit' });
  });

  it('takes the discount off above the subtotal, so each row is the sum so far', async () => {
    fetchMock.mockImplementationOnce(() =>
      respond(
        invoice({ subtotalAmount: 4000, discountAmount: 1000, taxAmount: 200, totalAmount: 4200, balanceDue: 4200 }),
      ),
    );
    const { container } = render(<PublicInvoiceView token="tok" justPaid={false} />);
    await screen.findByText('Subtotal');

    const rows = [...container.querySelectorAll('dl > div')].map((row) => row.textContent);
    expect(rows.slice(0, 5)).toEqual([
      'Lines5,000.00 AED',
      'Discount−1,000.00 AED',
      'Subtotal4,000.00 AED',
      'VAT200.00 AED',
      'Total4,200.00 AED',
    ]);
  });

  it('says how to pay when online payment is off', async () => {
    fetchMock.mockImplementationOnce(() => respond(invoice({ canPayOnline: false })));
    render(<PublicInvoiceView token="tok" justPaid={false} />);
    expect(await screen.findByText(/contact Northwind Print at accounts@northwind.test/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay/ })).not.toBeInTheDocument();
  });

  it('shows a paid invoice as paid', async () => {
    fetchMock.mockImplementationOnce(() =>
      respond(invoice({ paidAmount: 2100, balanceDue: 0, status: 'PAID' })),
    );
    render(<PublicInvoiceView token="tok" justPaid={false} />);
    expect(await screen.findByText('Paid in full. Thank you.')).toBeInTheDocument();
  });

  it('explains a dead link', async () => {
    fetchMock.mockImplementationOnce(() => respond({ message: 'This pay link has expired' }, 404));
    render(<PublicInvoiceView token="old" justPaid={false} />);
    expect(await screen.findByText('This pay link has expired')).toBeInTheDocument();
  });
});

describe('TestCheckout', () => {
  const props = {
    session: 'fake_cs_1',
    amount: 210000,
    currency: 'AED',
    description: 'Invoice INV-2026-0007',
    success: 'http://localhost:3000/pay/tok?paid=1',
    cancel: 'http://localhost:3000/pay/tok',
  };

  it('completes the session, then returns to the success page', async () => {
    fetchMock.mockImplementationOnce(() => respond({ received: true }));
    render(<TestCheckout {...props} />);
    expect(screen.getByText('2,100.00 AED')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(props.success));
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/public\/payments\/fake\/fake_cs_1\/complete$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ outcome: 'PAID' });
  });

  it('cancels without paying', async () => {
    fetchMock.mockImplementationOnce(() => respond({ received: true }));
    render(<TestCheckout {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(props.cancel));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ outcome: 'EXPIRED' });
  });

  it('never follows a return address on another site', async () => {
    fetchMock.mockImplementationOnce(() => respond({ received: true }));
    render(<TestCheckout {...props} success="https://evil.example/steal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
});

describe('DepositPanel', () => {
  const deposit = (overrides: Partial<PublicDepositDto> = {}): PublicDepositDto => ({
    label: '30% deposit',
    invoiceNumber: 'INV-2026-0008',
    amount: 630,
    balanceDue: 630,
    paid: false,
    canPayOnline: true,
    ...overrides,
  });

  it('offers to pay the deposit after acceptance', async () => {
    fetchMock.mockImplementationOnce(() => respond({ url: '/pay/checkout?session=fake_cs_2' }));
    render(<DepositPanel token="qt" deposit={deposit()} currency="AED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay deposit 630.00 AED' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/pay/checkout?session=fake_cs_2'));
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/public\/payments\/quotes\/qt\/deposit-checkout$/);
  });

  it('shows a paid deposit', () => {
    render(<DepositPanel token="qt" deposit={deposit({ paid: true, balanceDue: 0 })} currency="AED" />);
    expect(screen.getByText('Deposit paid. Thank you.')).toBeInTheDocument();
  });

  it('asks for payment offline when online payment is off', () => {
    render(<DepositPanel token="qt" deposit={deposit({ canPayOnline: false })} currency="AED" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/630.00 AED is due before work starts/)).toBeInTheDocument();
  });
});
