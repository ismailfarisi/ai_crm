'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** Where a line editor stands: an edit not yet saved, or one the server refused. */
export interface LineStatus {
  unsaved: boolean;
  rejected: boolean;
}

interface Registry {
  /** A line editor's flush: sends its pending edits now and settles once they are saved or refused. */
  register(lineId: string, flush: () => Promise<void>): () => void;
  report(lineId: string, status: LineStatus | null): void;
}

const PayrollLinesContext = createContext<Registry | null>(null);

export const PayrollLinesProvider = PayrollLinesContext.Provider;

export function usePayrollLinesRegistry(): Registry | null {
  return useContext(PayrollLinesContext);
}

/**
 * Owned by the run detail: lets Approve and Pay flush every line's debounced
 * edits first, and know whether any row is unsaved or was refused.
 */
export function usePayrollLines() {
  const flushers = useRef(new Map<string, () => Promise<void>>());
  const [statuses, setStatuses] = useState<Record<string, LineStatus>>({});

  const registry = useMemo<Registry>(
    () => ({
      register(lineId, flush) {
        flushers.current.set(lineId, flush);
        return () => {
          if (flushers.current.get(lineId) === flush) flushers.current.delete(lineId);
        };
      },
      report(lineId, status) {
        setStatuses((prev) => {
          if (!status) {
            if (!(lineId in prev)) return prev;
            const next = { ...prev };
            delete next[lineId];
            return next;
          }
          const cur = prev[lineId];
          if (cur && cur.unsaved === status.unsaved && cur.rejected === status.rejected) return prev;
          return { ...prev, [lineId]: status };
        });
      },
    }),
    [],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...flushers.current.values()].map((flush) => flush()));
  }, []);

  const all = Object.values(statuses);
  return {
    registry,
    flushAll,
    unsaved: all.some((s) => s.unsaved),
    rejected: all.some((s) => s.rejected),
  };
}
