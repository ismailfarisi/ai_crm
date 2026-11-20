import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomerSenderCheckDto } from '@saas/shared';
import { CustomerSenderBar } from './customer-sender';

const calls = {
  check: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  customers: vi.fn(),
};

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
/** Permissions the signed-in person lacks. */
let missing: string[] = [];
vi.mock('@/lib/session-context', () => ({
  useCan: (rule: { permission: string | string[] }) =>
    [rule.permission].flat().every((permission) => !missing.includes(permission)),
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      customers: { ...original.api.customers, list: (params: unknown) => calls.customers(params) },
      channels: {
        ...original.api.channels,
        customerSenders: {
          check: (provider: string, identifier: string) => calls.check(provider, identifier),
          link: (input: unknown) => calls.link(input),
          unlink: (id: string) => calls.unlink(id),
        },
      },
    },
  };
});

const check = (over: Partial<CustomerSenderCheckDto>): CustomerSenderCheckDto => ({
  status: 'UNKNOWN',
  customer: null,
  linkId: null,
  ...over,
});

function renderBar(provider = 'WHATSAPP_META', identifier = '971509990000') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomerSenderBar provider={provider} identifier={identifier} />
    </QueryClientProvider>,
  );
}

describe('CustomerSenderBar', () => {
  beforeEach(() => {
    Object.values(calls).forEach((fn) => fn.mockReset());
    missing = [];
    calls.customers.mockResolvedValue({
      items: [
        { id: 'cust-a', companyName: 'Al Noor Sweets', phone: '050 111 2222', email: null },
        { id: 'cust-b', companyName: 'Gulf Print', phone: null, email: null },
      ],
      total: 2,
    });
  });

  it('says a stranger is told nothing, and asks the channel about this exact sender', async () => {
    calls.check.mockResolvedValue(check({}));
    renderBar();
    expect(await screen.findByText('Customer: not known.')).toBeInTheDocument();
    expect(
      screen.getByText(/Agents tell this sender nothing about orders or quotes/),
    ).toBeInTheDocument();
    expect(calls.check).toHaveBeenCalledWith('WHATSAPP_META', '971509990000');
    expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument();
  });

  it('names the customer a number on a record belongs to', async () => {
    calls.check.mockResolvedValue(
      check({ status: 'ON_RECORD', customer: { id: 'cust-a', companyName: 'Al Noor Sweets' } }),
    );
    renderBar();
    expect(await screen.findByText('Customer: Al Noor Sweets.')).toBeInTheDocument();
    expect(screen.getByText(/This number is on Al Noor Sweets's customer record/)).toBeInTheDocument();
  });

  it('explains a number that two customers share', async () => {
    calls.check.mockResolvedValue(check({ status: 'AMBIGUOUS' }));
    renderBar();
    expect(await screen.findByText(/on more than one customer record/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link to a customer/ })).toBeInTheDocument();
  });

  it('offers no link for a sender that is not one person', async () => {
    calls.check.mockResolvedValue(check({ status: 'UNSUPPORTED' }));
    renderBar('TELEGRAM', '-100200300');
    expect(await screen.findByText(/cannot be matched to one customer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link/ })).not.toBeInTheDocument();
  });

  it('links the sender to the customer staff pick, after a warning', async () => {
    calls.check.mockResolvedValue(check({}));
    calls.link.mockResolvedValue({ id: 'link-1' });
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Link to a customer/ }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(/Only link 971509990000 if you are sure it belongs to the customer/),
    ).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Link sender' })).toBeDisabled();
    fireEvent.click(await dialog.findByLabelText(/Gulf Print/));
    fireEvent.click(dialog.getByRole('button', { name: 'Link sender' }));

    await waitFor(() =>
      expect(calls.link).toHaveBeenCalledWith({
        customerId: 'cust-b',
        provider: 'WHATSAPP_META',
        identifier: '971509990000',
      }),
    );
    await waitFor(() => expect(calls.check).toHaveBeenCalledTimes(2));
  });

  it('shows nothing, and asks nothing, to someone who cannot see customers', async () => {
    missing = ['customer:read'];
    renderBar();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.check).not.toHaveBeenCalled();
    expect(screen.queryByText(/Customer:/)).not.toBeInTheDocument();
  });

  it('shows who the sender is, without the link buttons, to someone who cannot edit customers', async () => {
    missing = ['customer:update'];
    calls.check.mockResolvedValue(check({}));
    renderBar();
    expect(await screen.findByText('Customer: not known.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link/ })).not.toBeInTheDocument();
  });

  it('removes a link staff made', async () => {
    calls.check.mockResolvedValue(
      check({
        status: 'LINKED',
        customer: { id: 'cust-b', companyName: 'Gulf Print' },
        linkId: 'link-1',
      }),
    );
    calls.unlink.mockResolvedValue({ success: true });
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove link' }));
    await waitFor(() => expect(calls.unlink).toHaveBeenCalledWith('link-1'));
  });
});
