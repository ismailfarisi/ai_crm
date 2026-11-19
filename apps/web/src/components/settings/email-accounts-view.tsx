'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, RefreshCw, Share2, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { formatDateTime, formatRelative } from '@/lib/utils';
import {
  useConnectGoogle,
  useDisconnectAccount,
  useEmailAccounts,
  useSetAccountShared,
  useSyncAccount,
} from '@/hooks/use-email';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useState } from 'react';
import type { EmailAccountDto } from '@saas/shared';

const SYNC_TONE = {
  ACTIVE: 'success',
  ERROR: 'danger',
  PAUSED: 'warning',
} as const;

export function EmailAccountsView() {
  const { can } = useSession();
  const { accounts, isLoading } = useEmailAccounts();
  const connect = useConnectGoogle();
  const disconnect = useDisconnectAccount();
  const syncNow = useSyncAccount();
  const setShared = useSetAccountShared();
  const [pendingDisconnect, setPendingDisconnect] = useState<EmailAccountDto | null>(null);
  const searchParams = useSearchParams();
  const announced = useRef(false);

  // The OAuth callback lands back here — surface the outcome once.
  useEffect(() => {
    if (announced.current) return;
    const gmail = searchParams.get('gmail');
    if (!gmail) return;
    announced.current = true;
    if (gmail === 'connected') {
      toast.success(
        `Connected ${searchParams.get('address') ?? 'your mailbox'}`,
      );
    } else {
      toast.error(
        `Could not connect Gmail: ${searchParams.get('reason') ?? 'unknown error'}`,
      );
    }
  }, [searchParams]);

  const canManage = can(PERMISSIONS.EMAIL_MANAGE);
  const canSend = can(PERMISSIONS.EMAIL_SEND);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email accounts"
        description="Connect your Google Workspace mailbox to read and send email inside Kerf. Each teammate connects their own."
        actions={
          canSend ? (
            <Button onClick={() => connect.mutate()} loading={connect.isPending}>
              <Mail className="size-4" aria-hidden />
              Connect Gmail
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mail className="size-8" />}
            title="No mailboxes connected"
            description="Connect your Google account and your email syncs into the Email workspace — sent as you, straight from Gmail."
            action={
              canSend ? (
                <Button onClick={() => connect.mutate()} loading={connect.isPending}>
                  Connect Gmail
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardBody className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {account.name
                        ? `${account.name} <${account.emailAddress}>`
                        : account.emailAddress}
                    </p>
                    <Badge tone={SYNC_TONE[account.syncStatus]}>
                      {account.syncStatus === 'ACTIVE'
                        ? 'Connected'
                        : account.syncStatus.toLowerCase()}
                    </Badge>
                    {account.isMine ? (
                      <Badge tone="brand">Mine</Badge>
                    ) : null}
                    {account.isShared ? <Badge tone="info">Shared</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {account.syncStatus === 'ERROR' ? (
                      <span className="inline-flex items-center gap-1 text-danger">
                        <TriangleAlert className="size-3.5" aria-hidden />
                        {account.syncError ?? 'Sync error — reconnect the account'}
                      </span>
                    ) : account.lastSyncedAt ? (
                      `Last synced ${formatRelative(account.lastSyncedAt)} · connected ${formatDateTime(account.createdAt)}`
                    ) : (
                      'Waiting for first sync…'
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncNow.mutate(account.id)}
                    loading={syncNow.isPending && syncNow.variables === account.id}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Sync now
                  </Button>
                  {(account.isMine || canManage) && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setShared.mutate({
                            id: account.id,
                            isShared: !account.isShared,
                          })
                        }
                      >
                        <Share2 className="size-3.5" aria-hidden />
                        {account.isShared ? 'Make private' : 'Share with team'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDisconnect(account)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Disconnect
                      </Button>
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onClose={() => setPendingDisconnect(null)}
        title="Disconnect mailbox?"
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={async () => {
          if (!pendingDisconnect) return;
          await disconnect.mutateAsync(pendingDisconnect.id);
          setPendingDisconnect(null);
        }}
      >
        {pendingDisconnect && (
          <p>
            Kerf will stop syncing{' '}
            <strong>{pendingDisconnect.emailAddress}</strong> and delete the
            synced copies of its threads. Nothing changes inside Gmail itself.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
