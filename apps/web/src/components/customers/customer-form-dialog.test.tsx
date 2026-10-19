import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerFormDialog } from './customer-form-dialog';

vi.mock('@/hooks/use-customers', () => ({
  useCreateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function open() {
  render(<CustomerFormDialog open onClose={() => {}} />);
}

const status = () => (screen.getByLabelText('VAT status') as HTMLSelectElement).value;

describe('CustomerFormDialog VAT fields', () => {
  it('defaults VAT status from country and TRN, and shows the emirate only for the UAE', () => {
    open();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AE' } });
    fireEvent.change(screen.getByLabelText('TRN'), { target: { value: '100 123 456 789 012' } });

    expect(status()).toBe('REGISTERED');
    expect(screen.getByLabelText('Emirate')).toBeDefined();
    expect(screen.getByText('15 digits, as on the FTA certificate')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } });

    expect(screen.queryByLabelText('Emirate')).toBeNull();
    expect(screen.getByLabelText('Tax ID')).toBeDefined();
    expect(status()).toBe('OUTSIDE_UAE');
  });

  it('stops following country and TRN once the user has chosen a status', () => {
    open();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AE' } });
    fireEvent.change(screen.getByLabelText('VAT status'), { target: { value: 'NOT_REGISTERED' } });
    fireEvent.change(screen.getByLabelText('TRN'), { target: { value: '100123456789012' } });

    expect(status()).toBe('NOT_REGISTERED');
  });

  it('warns when registered without a TRN', () => {
    open();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AE' } });
    fireEvent.change(screen.getByLabelText('VAT status'), { target: { value: 'REGISTERED' } });

    expect(
      screen.getByText('Invoices to this customer cannot be issued until a TRN is added.'),
    ).toBeDefined();
  });
});
