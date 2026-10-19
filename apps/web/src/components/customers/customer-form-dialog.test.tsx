import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerFormDialog } from './customer-form-dialog';

const createCustomer = vi.fn();
vi.mock('@/hooks/use-customers', () => ({
  useCreateCustomer: () => ({ mutateAsync: createCustomer, isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const orgCountry = vi.hoisted(() => ({ value: 'AE' as string | null }));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: { country: orgCountry.value } }),
}));

beforeEach(() => {
  orgCountry.value = 'AE';
  createCustomer.mockReset();
});

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

  it('sends no emirate after switching from the UAE to another country', async () => {
    open();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AE' } });
    fireEvent.change(screen.getByLabelText('Emirate'), { target: { value: 'DXB' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(createCustomer.mock.calls[0][0]).toMatchObject({ country: 'GB', emirate: null });
  });
});

describe('CustomerFormDialog outside the UAE', () => {
  it('is the plain form: no VAT status, emirate or TRN, and the API picks the status', async () => {
    orgCountry.value = 'GB';
    open();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AE' } });
    expect(screen.queryByLabelText('VAT status')).toBeNull();
    expect(screen.queryByLabelText('Emirate')).toBeNull();
    expect(screen.queryByLabelText('TRN')).toBeNull();
    expect(screen.queryByText('15 digits, as on the FTA certificate')).toBeNull();
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText('Tax ID / VAT'), { target: { value: 'GB123456789' } });

    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(createCustomer.mock.calls[0][0]).toMatchObject({ vatStatus: null, emirate: null });
  });
});
