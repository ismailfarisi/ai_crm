'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, Mail, RefreshCw, Share2, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { formatDateTime, formatRelative } from '@/lib/utils';
import {
  useConnectGoogle,
  useConnectImap,
  useDisconnectAccount,
  useEmailAccounts,
  useSetAccountShared,
  useSyncAccount,
} from '@/hooks/use-email';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import type { EmailAccountDto } from '@saas/shared';

const SYNC_TONE = {
  ACTIVE: 'success',
  ERROR: 'danger',
  PAUSED: 'warning',
} as const;

const PROVIDER_LABEL = {
  GMAIL_OAUTH: 'Google',
  IMAP_SMTP: 'App password',
} as const;

export function EmailAccountsView() {
  const { can } = useSession();
  const { accounts, isLoading } = useEmailAccounts();
  const connect = useConnectGoogle();
  const connectImap = useConnectImap();
  const disconnect = useDisconnectAccount();
  const syncNow = useSyncAccount();
  const setShared = useSetAccountShared();
  const [pendingDisconnect, setPendingDisconnect] = useState<EmailAccountDto | null>(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapAddress, setImapAddress] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapShared, setImapShared] = useState(false);
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

  const submitImap = async (e: FormEvent) => {
    e.preventDefault();
    await connectImap.mutateAsync(
      {
        emailAddress: imapAddress.trim(),
        appPassword: imapPassword,
        isShared: imapShared,
      },
      {
        onSuccess: () => {
          setShowImapForm(false);
          setImapAddress('');
          setImapPassword('');
          setImapShared(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email accounts"
        description="Connect your mailbox to read and send email inside Kerf. Each teammate connects their own — Google sign-in for our domain, an app password for any other Gmail or Workspace account."
        actions={
          canSend ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowImapForm((v) => !v)}
              >
                <KeyRound className="size-4" aria-hidden />
                App password
              </Button>
              <Button onClick={() => connect.mutate()} loading={connect.isPending}>
                <Mail className="size-4" aria-hidden />
                Connect Gmail
              </Button>
            </div>
          ) : undefined
        }
      />

      {showImapForm && canSend && (
        <Card>
          <CardBody>
            <form onSubmit={submitImap} className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Connect with an app password
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Works for any Gmail or Google Workspace account. In Google:
                  Account → Security → 2-Step Verification → App passwords →
                  create one for Mail, then paste the 16-letter code below.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Email address"
                  type="email"
                  required
                  value={imapAddress}
                  onChange={(e) => setImapAddress(e.target.value)}
                  placeholder="you@yourdomain.com"
                />
                <Input
                  label="App password"
                  type="password"
                  required
                  minLength={8}
                  value={imapPassword}
                  onChange={(e) => setImapPassword(e.target.value)}
                  placeholder="abcd efgh ijkl mnop"
                  autoComplete="off"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={imapShared}
                  onChange={(e) => setImapShared(e.target.checked)}
                />
                Share this mailbox with the team (read-only for others)
              </label>
              <div className="flex gap-2">
                <Button type="submit" loading={connectImap.isPending}>
                  Connect mailbox
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowImapForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

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
                    <Badge tone="neutral">
                      {PROVIDER_LABEL[account.providerType]}
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
