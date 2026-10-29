import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import { useExpenses, useReceiptSource } from './use-expenses';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      expenses: { ...original.api.expenses, list: vi.fn(), create: vi.fn(), uploadReceipt: vi.fn() },
      attachments: { ...original.api.attachments, link: vi.fn() },
    },
  };
});

const FILE_ID = '22222222-2222-4222-8222-222222222222';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useReceiptSource', () => {
  beforeEach(() => vi.mocked(api.attachments.link).mockReset());

  it('fetches a signed link for a stored receipt', async () => {
    vi.mocked(api.attachments.link).mockResolvedValue({
      url: 'https://api.example/attachments/x/download?token=t',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      filename: 'dewa-october.pdf',
    });
    const { result } = renderHook(() => useReceiptSource(`attachment:${FILE_ID}`), { wrapper });

    expect(result.current).toEqual({ src: null, isPdf: false, isLoading: true });
    await waitFor(() => expect(result.current.src).toBe('https://api.example/attachments/x/download?token=t'));
    expect(api.attachments.link).toHaveBeenCalledWith(FILE_ID);
    expect(result.current.isPdf).toBe(true);
  });

  it('shows a plain link or an older inline receipt as it is, without a request', () => {
    const { result } = renderHook(() => useReceiptSource('data:image/png;base64,AAAA'), { wrapper });
    expect(result.current).toEqual({ src: 'data:image/png;base64,AAAA', isPdf: false, isLoading: false });

    const { result: none } = renderHook(() => useReceiptSource(null), { wrapper });
    expect(none.current.src).toBeNull();
    expect(api.attachments.link).not.toHaveBeenCalled();
  });
});

describe('useExpenses().createClaim with a receipt', () => {
  beforeEach(() => {
    vi.mocked(api.expenses.list).mockResolvedValue([]);
    vi.mocked(api.expenses.create).mockResolvedValue({ id: 'exp-1', claimNumber: 'EXP-1' } as never);
    vi.mocked(api.expenses.uploadReceipt).mockReset();
  });

  it('files the claim, then uploads the receipt onto it', async () => {
    vi.mocked(api.expenses.uploadReceipt).mockResolvedValue({ id: 'exp-1', receiptUrl: `attachment:${FILE_ID}` } as never);
    const { result } = renderHook(() => useExpenses(), { wrapper });
    const pdf = new File(['%PDF'], 'r.pdf', { type: 'application/pdf' });

    let claim: unknown;
    await act(async () => {
      claim = await result.current.createClaim({ amount: 10, receiptUrl: null } as never, pdf);
    });

    expect(api.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ receiptUrl: null }));
    expect(api.expenses.uploadReceipt).toHaveBeenCalledWith('exp-1', pdf);
    expect(claim).toMatchObject({ receiptUrl: `attachment:${FILE_ID}` });
  });

  it('keeps the filed claim when the upload fails', async () => {
    vi.mocked(api.expenses.uploadReceipt).mockRejectedValue(new Error('storage down'));
    const { result } = renderHook(() => useExpenses(), { wrapper });

    let claim: unknown;
    await act(async () => {
      claim = await result.current.createClaim({ amount: 10 } as never, new File(['x'], 'r.png', { type: 'image/png' }));
    });
    expect(claim).toMatchObject({ id: 'exp-1' });
  });

  it('does not upload when there is no receipt', async () => {
    const { result } = renderHook(() => useExpenses(), { wrapper });
    await act(async () => {
      await result.current.createClaim({ amount: 10 } as never);
    });
    expect(api.expenses.uploadReceipt).not.toHaveBeenCalled();
  });
});
