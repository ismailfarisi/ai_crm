'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AssistantPendingAction } from '@saas/shared';
import { Button } from '@/components/ui/button';

interface ApprovalCardProps {
  pendingAction: AssistantPendingAction;
  onDecide: (approved: boolean, note?: string) => void;
  disabled?: boolean;
  expired?: boolean;
  onRetry?: () => void;
}

export function ApprovalCard({ pendingAction, onDecide, disabled, expired, onRetry }: ApprovalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const summary =
    typeof pendingAction.preview.summary === 'string'
      ? pendingAction.preview.summary
      : JSON.stringify(pendingAction.preview, null, 2);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
        <ShieldCheck className="size-4 text-amber-600" aria-hidden="true" />
        Needs your approval · <span className="font-mono text-xs text-ink-muted">{pendingAction.tool.name}</span>
      </div>
      <p className="whitespace-pre-wrap text-ink">{summary}</p>

      {expired ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-ink-muted">Expired</span>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            aria-label="Reason for rejecting"
            className="w-full rounded-lg border border-border bg-surface p-2 text-sm"
            placeholder="Why? (optional — the assistant will see this)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={disabled} onClick={() => onDecide(false, note.trim() || undefined)}>
              Confirm reject
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRejecting(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={disabled} onClick={() => onDecide(true, undefined)}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
