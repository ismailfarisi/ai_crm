'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import type { InvoiceDto, VoidInvoicePayload } from '@saas/shared';

export interface VoidInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDto | null;
  onSubmit: (payload: VoidInvoicePayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function VoidInvoiceModal({
  open,
  onClose,
  invoice,
  onSubmit,
  isLoading = false,
}: VoidInvoiceModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReason('');
      setError(null);
    }
  }, [open]);

  if (!invoice) return null;

  const hasPayments = (invoice.paidAmount ?? 0) > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({ reason: reason.trim() || undefined });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to void invoice.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Void Invoice ${invoice.invoiceNumber}`}
      description="Cancels the invoice. This cannot be undone."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {hasPayments && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              This invoice has recorded payments — voiding it will automatically reverse them and
              post a correcting journal entry.
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="input-void-reason" className="block text-xs font-bold text-ink">
            Reason (optional)
          </label>
          <Textarea
            id="input-void-reason"
            placeholder="e.g. Issued to the wrong customer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm" disabled={isLoading}>
            {isLoading ? 'Voiding...' : 'Void Invoice'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
