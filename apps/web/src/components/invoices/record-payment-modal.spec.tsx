import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FinanceAccountDto, InvoiceDto } from '@saas/shared';
import { RecordPaymentModal } from './record-payment-modal';

const invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-0007',
  amount: 1050,
  paidAmount: 0,
  currency: 'AED',
  issuedAt: '2026-11-20T09:30:00Z',
} as InvoiceDto;
const accounts = [{ id: 'acc-1', name: 'Operating Bank', balance: 0, currency: 'AED', accountNumber: null }] as FinanceAccountDto[];

function open(onSubmit = vi.fn()) {
  render(<RecordPaymentModal open onClose={() => {}} invoice={invoice} accounts={accounts} onSubmit={onSubmit} />);
  return onSubmit;
}

describe('RecordPaymentModal payment date', () => {
  it('starts the date picker at the invoice date', () => {
    open();
    expect(screen.getByLabelText('Payment Date')).toHaveAttribute('min', '2026-11-20');
  });

  it('refuses a date before the invoice and says which date to use, without calling the API', () => {
    const onSubmit = open();
    fireEvent.change(screen.getByLabelText('Payment Date'), { target: { value: '2026-10-11' } });
    fireEvent.submit(screen.getByLabelText('Payment Date').closest('form')!);
    expect(screen.getByText(/INV-2026-0007 was issued on 2026-11-20.*Use 2026-11-20 or later/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a payment dated the day of the invoice', async () => {
    const onSubmit = open();
    fireEvent.change(screen.getByLabelText('Payment Date'), { target: { value: '2026-11-20' } });
    fireEvent.submit(screen.getByLabelText('Payment Date').closest('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ accountId: 'acc-1', amount: 1050, paidAt: '2026-11-20' }));
  });
});
