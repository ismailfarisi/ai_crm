'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { type ChannelProvider } from '@saas/shared';
import { api, type ChannelMessageDto } from '@/lib/api/endpoints';
import { formatRelative, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import { ChannelBadge, channelName, type ThreadGroup } from './inbox-thread-list';

interface InboxChatPanelProps {
  thread: ThreadGroup | null;
  onMessageSent: () => void;
  /** Phone layout only: return to the thread list. */
  onBack?: () => void;
}

/** How an outbound message's delivery reads under the bubble. */
const OUTBOUND_STATUS: Record<ChannelMessageDto['status'], string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Not delivered',
  received: 'Received',
};

export function InboxChatPanel({ thread, onMessageSent, onBack }: InboxChatPanelProps) {
  const [provider, setProvider] = useState<ChannelProvider>('WHATSAPP_META');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-set recipient and preferred provider when thread changes
  useEffect(() => {
    if (!thread) return;

    // Infer best provider and default recipient based on last message or contact info
    const lastMsg = thread.lastMessage;
    const initialProvider = (lastMsg.provider || 'WHATSAPP_META') as ChannelProvider;
    setProvider(initialProvider);

    let defaultRecipient = thread.recipientOrSender;
    if (thread.contact) {
      if (initialProvider.startsWith('EMAIL') && thread.contact.email) {
        defaultRecipient = thread.contact.email;
      } else if (initialProvider === 'WHATSAPP_META' && thread.contact.phone) {
        defaultRecipient = thread.contact.phone;
      }
    }
    setRecipient(defaultRecipient);
    // Keyed on the thread's id, not the object: the inbox polls every 10s and
    // rebuilds the thread, which used to reset a recipient mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

  // Scroll to bottom when thread messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages]);

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface-muted/30 p-8 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-surface-muted text-ink-subtle mb-3">
          <MessageSquare className="size-6" />
        </div>
        <h3 className="text-sm font-semibold text-ink">No conversation open</h3>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">
          Pick a conversation from the list to read it and reply.
        </p>
      </div>
    );
  }

  // Sort messages chronologically (oldest to newest)
  const sortedMessages = [...thread.messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const isEmail = provider === 'EMAIL_SMTP' || provider === 'EMAIL_RESEND';

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !recipient.trim()) return;

    setIsSending(true);
    try {
      await api.channels.sendMessage({
        contactId: thread.contactId || undefined,
        provider,
        recipient: recipient.trim(),
        body: body.trim(),
        subject: isEmail ? subject.trim() : undefined,
      });

      toast.success('Message sent');
      setBody('');
      setSubject('');
      onMessageSent();
    } catch (err: any) {
      toast.error(err.message || "Couldn't send the message. Try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Thread Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border p-3 md:p-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="lg"
              onClick={onBack}
              aria-label="Back to conversations"
              className="-ml-1 shrink-0 gap-1.5 px-3"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
          )}
          <div
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-ink ring-1 ring-border"
          >
            {initials(thread.name, '')}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate font-semibold leading-none text-ink">{thread.name}</h3>
              {thread.staffUser && <Badge className="shrink-0">Staff</Badge>}
            </div>
            <p className="mt-1 truncate text-xs text-ink-muted">
              {thread.staffUser?.email || thread.contact?.email || thread.contact?.phone || thread.recipientOrSender}
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {Array.from(thread.providers).map((prov) => (
            <ChannelBadge key={prov} provider={prov} />
          ))}
        </div>
      </div>

      {/* Message History Feed */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-surface-muted/10 p-4 scrollbar-thin">
        {sortedMessages.length === 0 ? (
          <p className="text-center text-sm text-ink-subtle py-8">No messages in this conversation.</p>
        ) : (
          sortedMessages.map((msg) => {
            const isOutbound = msg.direction === 'OUTBOUND';
            const isFailed = isOutbound && msg.status === 'failed';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm text-ink shadow-xs md:max-w-[75%] ${
                    isOutbound
                      ? 'rounded-br-xs bg-surface-muted ' + (isFailed ? 'border-danger/40' : 'border-border')
                      : 'rounded-bl-xs border-border bg-surface'
                  }`}
                >
                  {/* Subject line for email messages */}
                  {msg.metadata?.subject && (
                    <p className="mb-1 text-xs font-semibold text-ink-muted">Subject: {msg.metadata.subject}</p>
                  )}

                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>

                  <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <span>{channelName(msg.provider)}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{formatRelative(msg.createdAt)}</span>
                    {isOutbound &&
                      (isFailed ? (
                        <Badge tone="danger">Not delivered</Badge>
                      ) : (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-medium">{OUTBOUND_STATUS[msg.status]}</span>
                        </>
                      ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="border-t border-border p-4 space-y-3 bg-surface">
        <div className="flex flex-wrap items-center gap-2">
          {/* Provider Selector */}
          <Select
            aria-label="Send through"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ChannelProvider)}
            containerClassName="w-full sm:w-44"
            options={[
              { value: 'WHATSAPP_META', label: 'WhatsApp Meta' },
              { value: 'TELEGRAM', label: 'Telegram Bot' },
              { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
              { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
            ]}
          />

          {/* Recipient Input */}
          <Input
            aria-label="Recipient"
            placeholder="Phone, email or chat ID"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            containerClassName="min-w-[12rem] flex-1"
          />
        </div>

        {/* Subject input (if email) */}
        {isEmail && (
          <Input
            aria-label="Subject"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        )}

        {/* Message body */}
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Reply"
            placeholder={`Reply by ${channelName(provider)}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            containerClassName="min-w-0 flex-1"
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSend(e);
              }
            }}
          />

          <Button
            type="submit"
            disabled={isSending || !body.trim() || !recipient.trim()}
            loading={isSending}
            size="lg"
            className="shrink-0"
          >
            <Send className="size-4" />
            Send
          </Button>
        </div>
        {/* Only a keyboard can press it; touch screens don't need the hint. */}
        <p className="hidden text-right text-xs text-ink-subtle pointer-fine:block">Ctrl+Enter or Cmd+Enter sends</p>
      </form>
    </div>
  );
}
