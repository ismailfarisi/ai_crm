'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';

export type InvoiceStatus = 'ISSUED' | 'PAID';

export interface Invoice {
  id: string;
  quoteId: string;
  tenantId: string;
  invoiceNumber: string;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string;
}

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
    refresh();
  }, [refresh]);

  return {
    invoices,
    isLoading,
    error,
    refresh,
  };
}
