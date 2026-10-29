'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { AUTOMATION_PERMISSIONS } from '@saas/shared';
import type { ApprovalAlreadyDecidedBody, AutomationApprovalDto } from '@saas/shared';
import { useDecideApproval } from '@/hooks/use-automations';
import { ApiError } from '@/lib/api/client';
import type { ApiErrorWithBody } from '@/lib/api/client';
import { describe } from '@/lib/api/describe';
import { useSession } from '@/lib/session-context';
import { formatRelative } from '@/lib/utils';

export interface ApprovalDecisionProps {
  approval: AutomationApprovalDto;
  onDecided?: () => void;
}

function alreadyDecidedMessage(body: Partial<ApprovalAlreadyDecidedBody> | undefined): string {
  const verb =
    body?.status === 'APPROVED' ? 'approved' : body?.status === 'REJECTED' ? 'rejected' : null;
  if (!verb) return 'No longer pending';
  const by = body?.decidedBy ? ` by ${body.decidedBy.name}` : '';
  const when = body?.decidedAt ? `, ${formatRelative(body.decidedAt)}` : '';
  return `Already ${verb}${by}${when}`;
}

export function ApprovalDecision({ approval, onDecided }: ApprovalDecisionProps) {
  const { can } = useSession();
  const decide = useDecideApproval();
  const [comment, setComment] = useState('');
  const [rejectIntent, setRejectIntent] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  if (!can(AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE)) return null;

  const submit = async (action: 'APPROVE' | 'REJECT') => {
    setNotice(null);
    try {
      await decide.mutateAsync({
        approvalId: approval.id,
        executionId: approval.executionId,
        workflowId: approval.workflowId,
        payload: { action, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      onDecided?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice({
          tone: 'info',
          text: alreadyDecidedMessage(
            (error as ApiErrorWithBody).body as Partial<ApprovalAlreadyDecidedBody> | undefined,
          ),
        });
        onDecided?.();
      } else {
        setNotice({ tone: 'error', text: describe(error, "Couldn't record the decision") });
      }
    }
  };

  return (
    <div
      data-testid="approval-decision"
      className="rounded-lg border border-brand/40 bg-brand-soft/40 p-3 space-y-2"
    >
      <p className="text-xs font-semibold text-ink">{approval.title}</p>
      <div className="space-y-1">
        <label
          htmlFor={`approval-comment-${approval.id}`}
          className="text-[11px] font-medium text-ink-muted"
        >
          {rejectIntent ? 'Reason' : 'Comment'}
        </label>
        <textarea
          id={`approval-comment-${approval.id}`}
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full rounded-lg border border-border p-2 text-xs text-ink bg-surface focus:border-brand focus:outline-none resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => submit('APPROVE')}
          className="flex-1 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-xs font-semibold text-ink-inverted cursor-pointer disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => submit('REJECT')}
          onMouseEnter={() => setRejectIntent(true)}
          onMouseLeave={() => setRejectIntent(false)}
          onFocus={() => setRejectIntent(true)}
          onBlur={() => setRejectIntent(false)}
          className="flex-1 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-xs font-semibold text-ink cursor-pointer disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={clsx('text-xs', notice.tone === 'error' ? 'text-danger' : 'text-ink-muted')}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
