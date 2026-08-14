'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type Invoice, type InvoiceStatus } from '@/lib/api/endpoints';
import { toast } from 'sonner';

export type { Invoice, InvoiceStatus };

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.invoices.list();
      setInvoices(data);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch invoices');
      setError(errorObj);
      toast.error('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api.invoices
      .list()
      .then((data) => {
        if (!ignore) {
          setInvoices(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          const errorObj = err instanceof Error ? err : new Error('Failed to fetch invoices');
          setError(errorObj);
          setIsLoading(false);
          toast.error('Failed to load invoices');
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  return {
    invoices,
    isLoading,
    error,
    refresh,
  };
}
