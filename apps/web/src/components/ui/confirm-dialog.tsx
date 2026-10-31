'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Runs the action. A rejected promise keeps the dialog open with the error inside it. */
  onConfirm: () => void | Promise<unknown>;
  /** Says what is about to happen, as a question: "Approve QT-2026-0014?" */
  title: string;
  /** What changes, and for whom. */
  description?: string;
  /** Names the action: "Approve quote", not "OK". */
  confirmLabel: string;
  /** `danger` for something that removes, voids or takes access away. */
  tone?: 'primary' | 'danger';
  /** The figures or records the decision is about. */
  children?: ReactNode;
}

/**
 * A pause before an action with consequences: approving, sending, removing,
 * changing someone's access. It states what will change and names the button
 * for the action, so nothing important happens on a stray click.
 *
 * Errors stay inside the dialog, because a toast would sit behind it unseen.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}
    </Dialog>
  );
}
