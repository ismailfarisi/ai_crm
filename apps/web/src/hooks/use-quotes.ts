'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';

export type QuoteCreatedBy = 'AI' | 'HUMAN';
export type QuoteStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Quote {
  id: string;
  tenantId: string;
  createdBy: QuoteCreatedBy;
  status: QuoteStatus;
  title: string;
  prompt?: string | null;
  items: QuoteItem[];
  totalAmount: number;
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuotePayload {
  createdBy: QuoteCreatedBy;
  title: string;
  prompt?: string;
  items?: QuoteItem[];
  totalAmount?: number;
}

export function useQuotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
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
    refresh();
  }, [refresh]);

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

  const sendSignal = useCallback(
    async (id: string, action: 'APPROVE' | 'REJECT' | 'OVERRIDE', payload?: any) => {
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
    sendSignal,
  };
}
