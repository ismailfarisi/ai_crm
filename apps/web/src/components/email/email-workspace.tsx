'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  Inbox as InboxIcon,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  Send,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  EmailFolder,
  EmailMessageDto,
  EmailThreadDetailDto,
  EmailThreadDto,
} from '@saas/shared';
import { PERMISSIONS, EMAIL_FOLDERS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { formatDateTime, formatRelative, cn } from '@/lib/utils';
import {
  useConnectGoogle,
  useEmailAccounts,
  useEmailThread,
  useEmailThreads,
  useSendEmail,
  useUpdateEmailThread,
} from '@/hooks/use-email';
import { api } from '@/lib/api/endpoints';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';

const FOLDER_ICON: Record<EmailFolder, typeof InboxIcon> = {
  INBOX: InboxIcon,
  SENT: Send,
  DRAFTS: PenSquare,
  ARCHIVE: Archive,
  SPAM: Trash2,
  TRASH: Trash2,
};

const FOLDER_LABEL: Record<EmailFolder, string> = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  DRAFTS: 'Drafts',
  ARCHIVE: 'Archive',
  SPAM: 'Spam',
  TRASH: 'Trash',
};

export function EmailWorkspace() {
  const { can } = useSession();
  const { accounts, isLoading: accountsLoading } = useEmailAccounts();
  const [folder, setFolder] = useState<EmailFolder>('INBOX');
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [page, setPage] = useState(1);

  const threadsQuery = useEmailThreads({ folder, accountId, page, limit: 30 });
  const threads = threadsQuery.data?.items ?? [];
  const meta = threadsQuery.data?.meta;

  const canSend = can(PERMISSIONS.EMAIL_SEND);
  const ownAccounts = accounts.filter((a) => a.isMine);
  const sendableAccounts = canSend ? ownAccounts : [];

  const changeFolder = (next: EmailFolder) => {
    setFolder(next);
    setPage(1);
    setSelectedThreadId(null);
  };

  if (!accountsLoading && accounts.length === 0) {
    return (
      <EmptyState
        icon={<Mail className="size-8" />}
        title="Connect a mailbox to get started"
        description="Each teammate connects their own Google Workspace mailbox under Settings → Email accounts."
        action={
          canSend ? (
            <ConnectButton />
          ) : (
            <Link href="/settings/email" className="text-sm font-medium text-ink underline">
              Go to Email accounts
            </Link>
          )
        }
      />
    );
  }

  return (
    <div className="flex h-[calc(100vh-11.5rem)] gap-4">
      {/* Left rail: compose, accounts, folders */}
      <aside className="flex w-52 shrink-0 flex-col gap-4">
        {canSend && (
          <Button onClick={() => setComposeOpen(true)} className="w-full">
            <PenSquare className="size-4" aria-hidden />
            Compose
          </Button>
        )}
        <Select
          aria-label="Mailbox"
          placeholder="All mailboxes"
          options={accounts.map((a) => ({ value: a.id, label: a.emailAddress }))}
          value={accountId ?? ''}
          onChange={(e) => {
            setAccountId(e.target.value || undefined);
            setPage(1);
            setSelectedThreadId(null);
          }}
        />
        <nav className="space-y-0.5">
          {EMAIL_FOLDERS.map((f) => {
            const Icon = FOLDER_ICON[f];
            return (
              <button
                key={f}
                onClick={() => changeFolder(f)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition',
                  folder === f
                    ? 'bg-charcoal font-semibold text-on-charcoal'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {FOLDER_LABEL[f]}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Thread list */}
      <section className="flex w-96 shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {threadsQuery.isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <EmptyState
              icon={<InboxIcon className="size-8" />}
              title={`Nothing in ${FOLDER_LABEL[folder].toLowerCase()}`}
              description="New mail appears after the next sync — usually within a minute."
            />
          ) : (
            threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedThreadId}
                onSelect={() => setSelectedThreadId(thread.id)}
              />
            ))
          )}
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border/25 px-4 py-2 text-xs text-ink-muted">
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!meta.hasPreviousPage}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!meta.hasNextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Detail pane */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface">
        {selectedThreadId ? (
          <ThreadDetail
            threadId={selectedThreadId}
            sendableAccounts={sendableAccounts}
          />
        ) : (
          <EmptyState
            icon={<MailOpen className="size-8" />}
            title="Select a conversation"
            description="Pick a thread on the left to read it here."
          />
        )}
      </section>

      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        accounts={sendableAccounts}
      />
    </div>
  );
}

function ConnectButton() {
  const connect = useConnectGoogle();
  return (
    <Button onClick={() => connect.mutate()} loading={connect.isPending}>
      Connect Gmail
    </Button>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: EmailThreadDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const counterpart =
    thread.participants.find((p) => p.toLowerCase() !== thread.accountEmail.toLowerCase()) ??
    thread.accountEmail;
  return (
    <button
      onClick={onSelect}
      className={cn(
        'block w-full border-b border-border/20 px-4 py-3 text-left transition',
        selected ? 'bg-brand-soft/50' : 'hover:bg-surface-muted/50',
      )}
    >
      <div className="flex items-center gap-2">
        {!thread.isRead && (
          <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
        )}
        <span className={cn('truncate text-sm', !thread.isRead ? 'font-semibold text-ink' : 'text-ink-muted')}>
          {counterpart}
        </span>
        {thread.isStarred && (
          <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="Starred" />
        )}
        <span className="ml-auto shrink-0 text-xs text-ink-subtle">
          {formatRelative(thread.lastMessageAt)}
        </span>
      </div>
      <p className={cn('mt-0.5 truncate text-sm', !thread.isRead ? 'font-medium text-ink' : 'text-ink-muted')}>
        {thread.subject || '(no subject)'}
      </p>
      <p className="mt-0.5 truncate text-xs text-ink-subtle">{thread.snippet}</p>
    </button>
  );
}

function ThreadDetail({
  threadId,
  sendableAccounts,
}: {
  threadId: string;
  sendableAccounts: { id: string; emailAddress: string }[];
}) {
  const { data: thread, isLoading } = useEmailThread(threadId);
  const updateThread = useUpdateEmailThread();

  if (isLoading || !thread) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const canSendFromThread = sendableAccounts.some(
    (a) => a.id === thread.emailAccountId,
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/25 px-6 py-4">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
          {thread.subject || '(no subject)'}
        </h2>
        <Badge tone="neutral">{thread.accountEmail}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            updateThread.mutate({ id: thread.id, isStarred: !thread.isStarred })
          }
          aria-label={thread.isStarred ? 'Unstar' : 'Star'}
        >
          <Star
            className={cn('size-4', thread.isStarred && 'fill-warning text-warning')}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            updateThread.mutate({ id: thread.id, isRead: !thread.isRead })
          }
        >
          {thread.isRead ? (
            <Mail className="size-4" aria-label="Mark unread" />
          ) : (
            <MailOpen className="size-4" aria-label="Mark read" />
          )}
        </Button>
        {thread.folder === 'ARCHIVE' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateThread.mutate({ id: thread.id, folder: 'INBOX' })}
          >
            <ArchiveRestore className="size-4" aria-hidden />
            Unarchive
          </Button>
        ) : thread.folder === 'INBOX' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateThread.mutate({ id: thread.id, folder: 'ARCHIVE' })}
          >
            <Archive className="size-4" aria-hidden />
            Archive
          </Button>
        ) : null}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 scrollbar-thin">
        {thread.messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
      </div>
      {canSendFromThread && <ReplyBox thread={thread} />}
    </>
  );
}

function MessageCard({ message }: { message: EmailMessageDto }) {
  return (
    <article className="rounded-2xl border border-border/40 bg-surface-muted/30 p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-ink">
          {message.fromName || message.fromEmail}
        </span>
        <span className="text-xs text-ink-subtle">
          to {message.toEmails.map((t) => t.name || t.email).join(', ')}
        </span>
        <time className="ml-auto text-xs text-ink-subtle">
          {formatDateTime(message.sentAt)}
        </time>
      </header>
      {message.bodyText ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink">
          {message.bodyText}
        </p>
      ) : message.bodyHtml ? (
        <iframe
          title="Message body"
          sandbox=""
          srcDoc={message.bodyHtml}
          className="mt-3 h-64 w-full rounded-xl border border-border/40 bg-white"
        />
      ) : (
        <p className="mt-3 text-sm italic text-ink-subtle">(empty message)</p>
      )}
      {message.attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <li key={a.id}>
              <a
                href={api.email.attachmentUrl(message.id, a.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-muted hover:text-ink"
              >
                <Paperclip className="size-3" aria-hidden />
                {a.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ReplyBox({ thread }: { thread: EmailThreadDetailDto }) {
  const send = useSendEmail();
  const [body, setBody] = useState('');

  const lastInbound = [...thread.messages]
    .reverse()
    .find((m) => m.direction === 'INBOUND');
  const to = lastInbound?.fromEmail;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!to || !body.trim()) return;
    send.mutate(
      {
        accountId: thread.emailAccountId,
        threadId: thread.id,
        to: [to],
        cc: [],
        bcc: [],
        subject: thread.subject.startsWith('Re:')
          ? thread.subject
          : `Re: ${thread.subject}`,
        bodyText: body,
      },
      { onSuccess: () => setBody('') },
    );
  };

  if (!to) return null;
  return (
    <form onSubmit={submit} className="border-t border-border/25 p-4">
      <div className="flex items-end gap-3">
        <Textarea
          aria-label={`Reply to ${to}`}
          placeholder={`Reply to ${to}…`}
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          containerClassName="flex-1"
        />
        <Button type="submit" loading={send.isPending} disabled={!body.trim()}>
          <Send className="size-4" aria-hidden />
          Send
        </Button>
      </div>
    </form>
  );
}

function ComposeDialog({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; emailAddress: string }[];
}) {
  const send = useSendEmail();
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const resolvedAccount = accountId || accounts[0]?.id || '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!resolvedAccount || !to.trim() || !body.trim()) return;
    send.mutate(
      {
        accountId: resolvedAccount,
        to: to.split(',').map((e) => e.trim()).filter(Boolean),
        cc: [],
        bcc: [],
        subject,
        bodyText: body,
      },
      {
        onSuccess: () => {
          setTo('');
          setSubject('');
          setBody('');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title="New email" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Select
          label="From"
          options={accounts.map((a) => ({ value: a.id, label: a.emailAddress }))}
          value={resolvedAccount}
          onChange={(e) => setAccountId(e.target.value)}
        />
        <Input
          label="To"
          type="email"
          required
          multiple
          placeholder="jane@example.com, bob@example.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <Textarea
          label="Message"
          required
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={send.isPending}>
            <Send className="size-4" aria-hidden />
            Send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
