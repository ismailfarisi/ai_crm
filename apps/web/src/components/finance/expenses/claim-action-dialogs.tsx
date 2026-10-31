'use client';

import React, { useState } from 'react';
import type { ExpenseClaimDto } from '@saas/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { formatExpenseCurrency } from './expense-money';

/**
 * Keeps the last claim on screen while its dialog closes, so the text does not
 * blank out under the closing dialog.
 */
function useShownClaim(claim: ExpenseClaimDto | null) {
  const [shown, setShown] = useState(claim);
  if (claim && claim !== shown) setShown(claim);
  return claim ?? shown;
}

function claimant(claim: ExpenseClaimDto): string {
  return claim.employeeName || 'the claimant';
}

function claimLabel(claim: ExpenseClaimDto): string {
  return claim.claimNumber || claim.id.slice(0, 8);
}

/** The figures being decided on: which claim, what for, and how much. */
export function ClaimFigures({ claim }: { claim: ExpenseClaimDto }) {
  const rows: [string, string][] = [
    ['Claim', claimLabel(claim)],
    ['Claimant', claim.employeeName || '—'],
    ['Merchant', claim.merchantName || '—'],
    ['Category', claim.category || '—'],
  ];
  return (
    <dl
      data-testid="claim-figures"
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-sm"
    >
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-ink-muted">{label}</dt>
          <dd className="text-end text-ink">{value}</dd>
        </React.Fragment>
      ))}
      <dt className="font-semibold text-ink">Amount</dt>
      <dd className="text-end font-semibold tabular-nums text-ink">
        {formatExpenseCurrency(claim.amount, claim.currency)}
      </dd>
    </dl>
  );
}

interface ClaimDialogProps {
  /** The claim being decided; null keeps the dialog closed. */
  claim: ExpenseClaimDto | null;
  onClose: () => void;
}

export function ApproveClaimDialog({
  claim,
  onClose,
  onConfirm,
}: ClaimDialogProps & { onConfirm: (claim: ExpenseClaimDto) => unknown }) {
  const shown = useShownClaim(claim);
  if (!shown) return null;
  const amount = formatExpenseCurrency(shown.amount, shown.currency);
  return (
    <ConfirmDialog
      open={Boolean(claim)}
      onClose={onClose}
      onConfirm={async () => {
        await onConfirm(shown);
      }}
      title={`Approve ${amount} for ${claimant(shown)}?`}
      description={`This posts the cost to the books under ${shown.category || 'operating expenses'} and records it as owed to ${claimant(shown)} until it is reimbursed.`}
      confirmLabel="Approve claim"
    >
      <ClaimFigures claim={shown} />
    </ConfirmDialog>
  );
}

export function ReimburseClaimDialog({
  claim,
  onClose,
  onConfirm,
  accountName,
}: ClaimDialogProps & {
  onConfirm: (claim: ExpenseClaimDto) => unknown;
  /** The account the money leaves, so the confirmation can name it. */
  accountName?: string | null;
}) {
  const shown = useShownClaim(claim);
  if (!shown) return null;
  const amount = formatExpenseCurrency(shown.amount, shown.currency);
  return (
    <ConfirmDialog
      open={Boolean(claim)}
      onClose={onClose}
      onConfirm={async () => {
        await onConfirm(shown);
      }}
      title={`Reimburse ${amount} to ${claimant(shown)}?`}
      description={
        accountName
          ? `This records the payment from ${accountName}.`
          : 'This records the payment from your default bank or cash account.'
      }
      confirmLabel="Reimburse claim"
    >
      <ClaimFigures claim={shown} />
    </ConfirmDialog>
  );
}

/**
 * Rejecting needs a reason, because the claimant is told why. The reason is
 * checked here before anything is sent, and the API refuses a blank one too.
 */
export function RejectClaimDialog({
  claim,
  onClose,
  onConfirm,
}: ClaimDialogProps & { onConfirm: (claim: ExpenseClaimDto, reason: string) => unknown }) {
  const shown = useShownClaim(claim);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!shown) return null;

  const close = () => {
    if (busy) return;
    setReason('');
    setReasonError(null);
    setSubmitError(null);
    onClose();
  };

  const confirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError('Say why the claim is rejected. The claimant will see this.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await onConfirm(shown, trimmed);
      setBusy(false);
      setReason('');
      setReasonError(null);
      onClose();
    } catch (err) {
      setBusy(false);
      setSubmitError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    }
  };

  return (
    <Dialog
      open={Boolean(claim)}
      onClose={close}
      title={`Reject ${formatExpenseCurrency(shown.amount, shown.currency)} from ${claimant(shown)}?`}
      description="Nothing is posted to the books. The claimant sees your reason and can correct the claim."
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} data-testid="btn-cancel-reject">
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={busy}
            onClick={confirm}
            data-testid="btn-confirm-reject"
          >
            Confirm rejection
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ClaimFigures claim={shown} />
        <Textarea
          label="Reason for rejecting"
          required
          data-testid="input-rejection-reason"
          placeholder="e.g. No itemised receipt, or over the meals limit"
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(null);
          }}
          rows={3}
        />
        {submitError && (
          <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
            {submitError}
          </p>
        )}
      </div>
    </Dialog>
  );
}
