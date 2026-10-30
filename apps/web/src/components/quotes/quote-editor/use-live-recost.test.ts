import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { QuoteLineItem } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useLiveRecost } from './use-live-recost';

vi.mock('@/lib/api/endpoints', () => ({
  api: { catalog: { resolveLines: vi.fn() } },
}));

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));

const catalogLine: QuoteLineItem = {
  id: 'line-1',
  type: 'product',
  description: 'Rigid box',
  catalogItemId: '11111111-1111-4111-8111-111111111111',
  quantity: 1,
  unitPrice: 4.6,
  subtotal: 4.6,
  cost: { unitCost: 3.18, totalCost: 3.18, source: 'STANDARD' },
};

const templateLine: QuoteLineItem = {
  ...catalogLine,
  id: 'line-2',
  catalogItemId: null,
  templateId: '22222222-2222-4222-8222-222222222222',
  parameters: { length_mm: 200 },
  cost: { unitCost: 2, totalCost: 200, source: 'COMPUTED' },
  quantity: 100,
};

describe('useLiveRecost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.catalog.resolveLines).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('scales a catalog line cost with its quantity, as the server does', () => {
    const setItems = vi.fn();
    const { result } = renderHook(() => useLiveRecost(setItems));

    const [next] = result.current.apply([catalogLine], [{ ...catalogLine, quantity: 500 }]);
    expect(next.cost?.totalCost).toBe(1590);
    expect(result.current.recosting.size).toBe(0);
  });

  it('leaves the cost alone when the quantity did not change', () => {
    const { result } = renderHook(() => useLiveRecost(vi.fn()));
    const edited = { ...catalogLine, unitPrice: 5 };
    expect(result.current.apply([catalogLine], [edited])[0]).toBe(edited);
  });

  /** A template has steps in its cost, so the costing engine answers, once the typing stops. */
  it('sends a template line back to the costing engine and waits for it', async () => {
    let items = [templateLine];
    const setItems = vi.fn((update: QuoteLineItem[] | ((prev: QuoteLineItem[]) => QuoteLineItem[])) => {
      items = typeof update === 'function' ? update(items) : update;
    });
    vi.mocked(api.catalog.resolveLines).mockResolvedValue({
      lines: [{ ...templateLine, quantity: 500, cost: { unitCost: 1.5, totalCost: 750, source: 'COMPUTED' } }],
    } as never);
    const { result } = renderHook(() => useLiveRecost(setItems));

    act(() => {
      items = result.current.apply(items, [{ ...templateLine, quantity: 500 }]);
    });
    expect(result.current.recosting.has('line-2')).toBe(true);
    expect(api.catalog.resolveLines).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(api.catalog.resolveLines).toHaveBeenCalledWith({
      lines: [
        expect.objectContaining({
          kind: 'TEMPLATE',
          templateId: templateLine.templateId,
          quantity: 500,
          parameters: { length_mm: 200 },
        }),
      ],
    });
    expect(items[0].cost?.totalCost).toBe(750);
    expect(result.current.recosting.size).toBe(0);
  });
});
