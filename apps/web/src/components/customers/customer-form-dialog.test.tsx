import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CustomerDto } from '@saas/shared';
import { CustomerFormDialog } from './customer-form-dialog';

const createCustomer = vi.fn();
const updateCustomer = vi.fn();
vi.mock('@/hooks/use-customers', () => ({
  useCreateCustomer: () => ({ mutateAsync: createCustomer, isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: updateCustomer, isPending: false }),
}));

// `loaded: false` is the organization query still pending, or refused.
const org = vi.hoisted(() => ({ country: 'AE' as string | null, loaded: true }));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: org.loaded ? { country: org.country } : undefined }),
}));

beforeEach(() => {
  org.country = 'AE';
  org.loaded = true;
  createCustomer.mockReset();
  updateCustomer.mockReset();
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
    org.country = 'GB';
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

describe('CustomerFormDialog before the organization is known', () => {
  it('keeps the UAE fields hidden and sends no VAT status or emirate on an update', async () => {
    org.loaded = false;
    const customer = {
      id: 'c1',
      companyName: 'Acme',
      contactName: null,
      email: null,
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      postalCode: null,
      country: 'AE',
      taxId: '100123456789012',
      emirate: 'DXB',
      vatStatus: 'REGISTERED',
      currency: 'AED',
      paymentTermsDays: 30,
      notes: null,
    } as unknown as CustomerDto;
    render(<CustomerFormDialog open onClose={() => {}} customer={customer} />);

    expect(screen.queryByLabelText('VAT status')).toBeNull();
    expect(screen.queryByLabelText('Emirate')).toBeNull();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+971 4 000 0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled());
    const { input } = updateCustomer.mock.calls[0][0];
    expect(input).not.toHaveProperty('vatStatus');
    expect(input).not.toHaveProperty('emirate');
    expect(input).toMatchObject({ phone: '+971 4 000 0000', country: 'AE' });
  });
});
