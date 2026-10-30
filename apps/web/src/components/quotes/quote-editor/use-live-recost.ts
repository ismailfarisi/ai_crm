'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { QuoteLineItem } from '@saas/shared';
import { api } from '@/lib/api/endpoints';

/** How long a quantity has to sit still before a template line is re-costed. */
const SETTLE_MS = 400;

const round2 = (value: number) => Number(value.toFixed(2));

/**
 * Keeps each line's cost in step with its quantity while it is edited.
 *
 * A line's cost is a snapshot taken when it was added — at quantity 1 from
 * the picker — and editing the quantity used to change only the price. So 500
 * boxes carried the cost of one, and the live margin read 99.8% on a job that
 * lost money. The server re-costs on every save, so nothing wrong was stored;
 * the wrong figure sat in front of the estimator while they priced.
 *
 * A catalog item's cost is its standing unit cost times the quantity, which
 * the browser can do exactly. A template's cost has steps in it (sheets are
 * bought whole, setup is charged once per run), so it goes back to the
 * costing engine, and the margin says "Re-costing…" until the answer is in.
 */
export function useLiveRecost(setItems: Dispatch<SetStateAction<QuoteLineItem[]>>) {
  const [recosting, setRecosting] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The latest quantity asked for per line, so a slow answer for an old
  // quantity never overwrites a newer one.
  const requested = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const settle = useCallback((lineId: string) => {
    timers.current.delete(lineId);
    requested.current.delete(lineId);
    setRecosting((prev) => {
      if (!prev.has(lineId)) return prev;
      const next = new Set(prev);
      next.delete(lineId);
      return next;
    });
  }, []);

  const recostTemplate = useCallback(
    async (line: QuoteLineItem, quantity: number) => {
      try {
        const resolved = await api.catalog.resolveLines({
          lines: [
            {
              kind: 'TEMPLATE',
              templateId: line.templateId!,
              quantity,
              parameters: line.parameters ?? {},
              toolingAlreadyOwned: [],
              discount: 0,
            },
          ],
        });
        if (requested.current.get(line.id) !== quantity) return;
        const cost = resolved.lines[0]?.cost ?? null;
        setItems((prev) =>
          prev.map((item) =>
            item.id === line.id && Math.round(Number(item.quantity) || 0) === quantity ? { ...item, cost } : item,
          ),
        );
        settle(line.id);
      } catch {
        if (requested.current.get(line.id) !== quantity) return;
        // An old cost against a new quantity is the wrong number; no cost is
        // an honest gap, and saving re-costs it on the server anyway.
        setItems((prev) => prev.map((item) => (item.id === line.id ? { ...item, cost: null } : item)));
        settle(line.id);
        toast.warning(`Could not re-cost "${line.description || 'a line'}". It is re-costed when you save.`);
      }
    },
    [setItems, settle],
  );

  /** Takes the lines before and after an edit and returns them with costs that match. */
  const apply = useCallback(
    (prev: QuoteLineItem[], next: QuoteLineItem[]): QuoteLineItem[] =>
      next.map((item) => {
        if (item.type !== 'product' || !item.cost) return item;
        const before = prev.find((line) => line.id === item.id);
        const quantity = Number(item.quantity) || 0;
        if (!before || (Number(before.quantity) || 0) === quantity) return item;

        if (item.templateId && quantity > 0) {
          const whole = Math.max(1, Math.round(quantity));
          requested.current.set(item.id, whole);
          setRecosting((current) => (current.has(item.id) ? current : new Set(current).add(item.id)));
          clearTimeout(timers.current.get(item.id));
          timers.current.set(
            item.id,
            setTimeout(() => void recostTemplate(item, whole), SETTLE_MS),
          );
          return item;
        }

        // Linear: the standing unit cost times the quantity, as the server does it.
        return { ...item, cost: { ...item.cost, totalCost: round2(Number(item.cost.unitCost) * quantity) } };
      }),
    [recostTemplate],
  );

  /** A line that went away has nothing left to re-cost. */
  const forget = useCallback(
    (lineIds: string[]) => {
      for (const lineId of lineIds) {
        clearTimeout(timers.current.get(lineId));
        settle(lineId);
      }
    },
    [settle],
  );

  return { apply, recosting, forget };
}
