'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import type { InvoiceDto } from '@saas/shared';

export interface ReplaceInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDto | null;
  onSubmit: (payload: { reason?: string }) => Promise<void> | void;
  isLoading?: boolean;
}

/**
 * Confirms the two-step correction: the issued invoice is voided (with an
 * audit trail) and a draft quote carrying its lines is opened for correction.
 * Accepting that quote raises the replacement invoice on a new number.
 */
export function ReplaceInvoiceModal({
  open,
  onClose,
  invoice,
  onSubmit,
  isLoading = false,
}: ReplaceInvoiceModalProps) {
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to replace invoice.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Replace Invoice ${invoice.invoiceNumber}`}
      description="Voids this invoice and opens a draft quote with the same lines, ready to correct, approve and have accepted."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-xs font-semibold text-danger">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <ul className="list-disc space-y-1.5 ps-4 text-xs text-ink-muted">
          <li>
            {invoice.invoiceNumber} is voided — it stays on file as cancelled and its number is not
            reused.
          </li>
          <li>
            A draft quote with the same customer and items opens next. Correct what was wrong and
            approve it; the replacement invoice is raised when the customer accepts it, or when you
            mark it as accepted.
          </li>
          <li>The replacement gets the next invoice number in sequence.</li>
        </ul>

        {hasPayments && (
          <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-xs font-semibold text-ink">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              This invoice has recorded payments — voiding will automatically reverse them. Record
              them again on the replacement invoice.
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="input-replace-reason" className="block text-xs font-semibold text-ink">
            Reason (optional)
          </label>
          <Textarea
            id="input-replace-reason"
            placeholder="e.g. Wrong quantity on line 2"
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
            {isLoading ? 'Replacing…' : 'Void & create draft'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
