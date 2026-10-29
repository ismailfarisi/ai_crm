'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AutomationApprovalDto } from '@saas/shared';
import { useAutomationApprovals } from '@/hooks/use-automations';
import { ApprovalDecision } from '@/components/automations/runs/approval-decision';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { formatRelative } from '@/lib/utils';

function timeoutLine(approval: AutomationApprovalDto): string {
  if (!approval.expiresAt) return 'No timeout shown';
  const when = formatRelative(approval.expiresAt);
  return approval.kind === 'agent_action'
    ? `Times out ${when} — the action is dropped`
    : `Times out ${when} — takes the timeout path`;
}

function ApprovalDetails({ approval }: { approval: AutomationApprovalDto }) {
  const details = approval.details as { message?: unknown; tool?: unknown; preview?: unknown };
  if (approval.kind === 'agent_action') {
    const preview =
      typeof details.preview === 'string'
        ? details.preview
        : details.preview === undefined
          ? ''
          : JSON.stringify(details.preview, null, 2);
    return (
      <div className="space-y-1 text-xs text-ink">
        <p className="font-medium">{String(details.tool ?? '')}</p>
        {preview && (
          <pre className="max-h-48 overflow-auto rounded-lg bg-surface-muted p-2 text-[11px] whitespace-pre-wrap">
            {preview}
          </pre>
        )}
      </div>
    );
  }
  return typeof details.message === 'string' && details.message ? (
    <p className="text-xs text-ink">{details.message}</p>
  ) : null;
}

export function ApprovalsInbox() {
  const { data, isLoading, isError, refetch } = useAutomationApprovals();
  // A decided (or already-decided) item leaves at once, ahead of the refetch.
  const [gone, setGone] = useState<Set<string>>(new Set());

  const items = [...(data ?? [])]
    .filter((a) => !gone.has(a.id))
    .sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

  const leave = (id: string, result: { conflict?: string }) => {
    setGone((prev) => new Set(prev).add(id));
    if (result.conflict) toast.info(result.conflict);
  };

  return (
    <div data-testid="approvals-inbox" className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Automation steps and AI actions waiting for a decision."
      />
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <EmptyState
          title="Couldn't load approvals."
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title="Nothing is waiting for approval."
        />
      ) : (
        <ul className="space-y-4">
          {items.map((approval) => (
            <li key={approval.id}>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/automations/${approval.workflowId}`}
                      className="text-sm font-semibold text-ink hover:text-brand"
                    >
                      {approval.workflowName}
                    </Link>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      {approval.kind === 'agent_action' ? 'AI action' : 'Approval step'}
                    </span>
                  </div>
                  <p className="text-sm text-ink">{approval.title}</p>
                  <p className="text-xs text-ink-muted">{approval.triggerSummary}</p>
                  <p className="text-xs text-ink-muted">
                    Requested {formatRelative(approval.requestedAt)}
                  </p>
                  <p className="text-xs text-ink-muted">{timeoutLine(approval)}</p>
                  <ApprovalDetails approval={approval} />
                  <ApprovalDecision approval={approval} onDecided={(r) => leave(approval.id, r)} />
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
