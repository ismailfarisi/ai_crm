'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';
import type {
  QuoteDto,
  CreateQuotePayload,
  UpdateQuotePayload,
  QuoteLineItem,
  QuoteLineItemType,
  QuoteStatus,
  QuoteCreatedBy,
  QuoteTotals,
} from '@saas/shared';
import { calculateQuoteTotals } from '@saas/shared';

// Re-export shared types for consumers of this hook
export type {
  QuoteDto,
  CreateQuotePayload,
  UpdateQuotePayload,
  QuoteLineItem,
  QuoteLineItemType,
  QuoteStatus,
  QuoteCreatedBy,
  QuoteTotals,
};
export { calculateQuoteTotals };

// Backward compatibility aliases
export type Quote = QuoteDto;
export type QuoteItem = QuoteLineItem;

export function useQuotes() {
  const [quotes, setQuotes] = useState<QuoteDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.quotes.list();
      setQuotes(data);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch quotes');
      setError(errorObj);
      toast.error('Failed to load quotes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api.quotes
      .list()
      .then((data) => {
        if (!ignore) {
          setQuotes(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          const errorObj = err instanceof Error ? err : new Error('Failed to fetch quotes');
          setError(errorObj);
          setIsLoading(false);
          toast.error('Failed to load quotes');
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const createQuote = useCallback(
    async (payload: CreateQuotePayload) => {
      try {
        const newQuote = await api.quotes.create(payload);
        toast.success('Quote created successfully');
        await refresh();
        return newQuote;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to create quote');
        toast.error(errorObj.message || 'Failed to create quote');
        throw errorObj;
      }
    },
    [refresh]
  );

  const updateQuote = useCallback(
    async (id: string, payload: UpdateQuotePayload) => {
      try {
        const updatedQuote = await api.quotes.update(id, payload);
        toast.success('Quote updated successfully');
        await refresh();
        return updatedQuote;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to update quote');
        toast.error(errorObj.message || 'Failed to update quote');
        throw errorObj;
      }
    },
    [refresh]
  );

  const sendSignal = useCallback(
    async (id: string, action: 'APPROVE' | 'REJECT' | 'OVERRIDE', payload?: unknown) => {
      try {
        const updatedQuote = await api.quotes.signal(id, { action, payload });
        toast.success(`Quote ${action.toLowerCase()}d successfully`);
        await refresh();
        return updatedQuote;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to send quote signal');
        toast.error(errorObj.message || 'Failed to send quote signal');
        throw errorObj;
      }
    },
    [refresh]
  );

  return {
    quotes,
    isLoading,
    error,
    refresh,
    createQuote,
    updateQuote,
    sendSignal,
  };
}

export function useQuote(id: string | null) {
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!id) {
      setQuote(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.quotes.get(id);
      setQuote(data);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch quote');
      setError(errorObj);
      toast.error('Failed to load quote');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setQuote(null);
      setIsLoading(false);
      return;
    }

    let ignore = false;
    api.quotes
      .get(id)
      .then((data) => {
        if (!ignore) {
          setQuote(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          const errorObj = err instanceof Error ? err : new Error('Failed to fetch quote');
          setError(errorObj);
          setIsLoading(false);
          toast.error('Failed to load quote');
        }
      });

    return () => {
      ignore = true;
    };
  }, [id]);

  return {
    quote,
    isLoading,
    error,
    refresh,
    setQuote,
  };
}
