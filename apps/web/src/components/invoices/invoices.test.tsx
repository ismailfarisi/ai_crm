import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { InvoiceDto } from '@saas/shared';
import { InvoicesTable } from './invoices-table';
import { summariseInvoices } from './invoices-view';

vi.mock('@/lib/session-context', () => ({
  useCan: () => true,
}));

let seq = 0;
const invoice = (overrides: Partial<InvoiceDto>): InvoiceDto =>
  ({
    id: `inv-${++seq}`,
    tenantId: 't-1',
    quoteId: 'q-1',
    quoteNumber: 'QT-2026-0042',
    invoiceNumber: `INV-2026-00${seq}`,
    customerName: 'Al Noor Sweets',
    customerEmail: 'accounts@alnoor.example',
    currency: 'AED',
    items: [],
    subtotalAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    amount: 0,
    status: 'ISSUED',
    paymentTerms: 'net_30',
    issuedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }) as InvoiceDto;

describe('summariseInvoices', () => {
  it('leaves voided invoices out and adds only the base currency', () => {
    const summary = summariseInvoices(
      [
        invoice({ amount: 1000, paidAmount: 400, status: 'PARTIALLY_PAID' }),
        invoice({ amount: 500, paidAmount: 500, status: 'PAID' }),
        invoice({ amount: 9000, status: 'CANCELLED' }),
        invoice({ amount: 300, currency: 'USD' }),
      ],
      'AED',
    );
    expect(summary).toEqual({ liveCount: 3, voidedCount: 1, issued: 1500, paid: 900, otherCurrencies: 1 });
  });
});

describe('InvoicesTable', () => {
  it('keeps Record payment as the one visible action and puts Void in the menu', () => {
    const onVoid = vi.fn();
    const unpaid = invoice({ amount: 1000, invoiceNumber: 'INV-2026-0100' });
    render(
      <InvoicesTable
        invoices={[unpaid]}
        onRecordPayment={vi.fn()}
        onVoid={onVoid}
        onPrint={vi.fn()}
        onDownload={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const pay = screen.getByRole('button', { name: 'Record payment on INV-2026-0100' });
    expect(pay.className).not.toContain('bg-brand');
    expect(pay.className).not.toContain('bg-danger');
    expect(screen.queryByRole('menuitem', { name: /Void/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for INV-2026-0100' }));
    const menu = screen.getByRole('menu');
    for (const name of ['Preview and print', 'Download PDF', 'Email to customer']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeDefined();
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Void invoice' }));
    expect(onVoid).toHaveBeenCalledWith(unpaid);
  });

  it('prints the quote number in ink, not amber', () => {
    render(<InvoicesTable invoices={[invoice({})]} />);
    const link = screen.getByRole('link', { name: 'QT-2026-0042' });
    expect(link.className).toContain('text-ink');
    expect(link.className).not.toContain('text-brand');
  });
});
