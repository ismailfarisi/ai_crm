import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PublicQuoteDto, PublicQuoteProofDto } from '@saas/shared';
import { PublicQuoteProofs, PublicQuoteRespond } from './public-quote-responses';

const proof = (overrides: Partial<PublicQuoteProofDto> = {}): PublicQuoteProofDto => ({
  id: 'p2',
  version: 2,
  status: 'PENDING',
  filename: 'box-v2.png',
  contentType: 'image/png',
  url: 'https://api.example.test/attachments/a2/download?sig=x',
  urlExpiresAt: '2026-11-01T10:05:00.000Z',
  staffNote: null,
  respondedAt: null,
  respondedByName: null,
  responseComment: null,
  superseded: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

const quote = (overrides: Partial<PublicQuoteDto> = {}): PublicQuoteDto =>
  ({
    organizationName: 'Northside Print',
    customerName: 'Acme',
    acceptedAt: null,
    acceptedByName: null,
    customerResponse: null,
    proofs: [],
    proofRequired: false,
    proofBlocksAcceptance: false,
    ...overrides,
  }) as PublicQuoteDto;

function renderRespond(q: PublicQuoteDto, call = vi.fn(async () => q)) {
  const onChange = vi.fn();
  let name = '';
  const view = render(
    <PublicQuoteRespond quote={q} token="tok" call={call} name={name} onNameChange={(v) => (name = v)} onChange={onChange} />,
  );
  const rerenderWithName = (value: string) => {
    name = value;
    view.rerender(
      <PublicQuoteRespond quote={q} token="tok" call={call} name={name} onNameChange={(v) => (name = v)} onChange={onChange} />,
    );
  };
  return { call, onChange, rerenderWithName };
}

describe('PublicQuoteRespond', () => {
  it('explains why Accept is blocked until the proof is approved', () => {
    const { rerenderWithName } = renderRespond(
      quote({ proofRequired: true, proofBlocksAcceptance: true, proofs: [proof()] }),
    );
    rerenderWithName('Jo Bloggs');

    expect(screen.getByRole('status').textContent).toContain('approve the artwork proof above first');
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Accept quote' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('needs a note to request changes and posts it', async () => {
    const { call, onChange, rerenderWithName } = renderRespond(quote());
    rerenderWithName('Jo Bloggs');
    fireEvent.click(screen.getByRole('radio', { name: 'Request changes' }));

    const send = screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What would you like changed?'), { target: { value: 'Matt finish' } });
    fireEvent.click(send);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith('tok/request-changes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Jo Bloggs', note: 'Matt finish' }),
    });
  });

  it('declines without a reason', async () => {
    const { call, rerenderWithName } = renderRespond(quote());
    rerenderWithName('Jo Bloggs');
    fireEvent.click(screen.getByRole('radio', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline quote' }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('tok/decline', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jo Bloggs', reason: null }),
      }),
    );
  });

  it('shows a decline instead of the form', () => {
    renderRespond(
      quote({ customerResponse: { kind: 'DECLINED', note: null, name: 'Jo', at: '2026-11-01T10:00:00.000Z' } }),
    );
    expect(screen.getByText(/You declined this quote/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Accept quote' })).toBeNull();
  });
});

describe('PublicQuoteProofs', () => {
  it('shows the latest proof and posts an approval for it', async () => {
    const q = quote({
      proofs: [proof(), proof({ id: 'p1', version: 1, status: 'CHANGES_REQUESTED', superseded: true, responseComment: 'Logo bigger' })],
    });
    const call = vi.fn(async () => q);
    render(<PublicQuoteProofs quote={q} token="tok" call={call} name="Jo Bloggs" onNameChange={() => {}} onChange={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Artwork proof v2' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Proof v2' })).toBeDefined();
    expect(screen.getByText('Earlier versions (1)')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Approve proof' }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('tok/proofs/p2/approve', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jo Bloggs' }),
      }),
    );
  });

  it('offers no actions once the proof is answered', () => {
    const q = quote({ proofs: [proof({ status: 'APPROVED', respondedByName: 'Jo' })] });
    render(<PublicQuoteProofs quote={q} token="tok" call={vi.fn()} name="" onNameChange={() => {}} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Approve proof' })).toBeNull();
    expect(screen.getByText(/Approved by Jo/)).toBeDefined();
  });
});
