'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { type ChannelProvider, type ContactDto } from '@saas/shared';
import { api, queryKeys, type ChannelMessageDto } from '@/lib/api/endpoints';
import { formatRelative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ChannelBadge } from '@/components/inbox/inbox-thread-list';

interface ContactMessagesTabProps {
  contact: ContactDto;
}

export function ContactMessagesTab({ contact }: ContactMessagesTabProps) {
  const [provider, setProvider] = useState<ChannelProvider>('WHATSAPP_META');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const {
    data: messages = [],
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.channelMessages({ contactId: contact.id }),
    queryFn: () => api.channels.messages({ contactId: contact.id, limit: 100 }),
    refetchInterval: 10000,
  });

  const isEmail = provider === 'EMAIL_SMTP' || provider === 'EMAIL_RESEND';

  const defaultRecipient =
    isEmail ? contact.email || '' : contact.phone || contact.email || '';

  const [recipient, setRecipient] = useState(defaultRecipient);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    const targetRecipient = recipient.trim() || defaultRecipient;
    if (!targetRecipient) {
      toast.error('Recipient email or phone number is required');
      return;
    }

    setIsSending(true);
    try {
      await api.channels.sendMessage({
        contactId: contact.id,
        provider,
        recipient: targetRecipient,
        body: body.trim(),
        subject: isEmail ? subject.trim() : undefined,
      });

      toast.success('Message sent');
      setBody('');
      setSubject('');
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  // Sort chronologically (oldest first for feed layout)
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="space-y-6">
      {/* Quick reply composer */}
      <Card className="p-4 space-y-3 border-border">
        <h4 className="text-sm font-semibold text-ink">Send Message to {contact.fullName}</h4>

        <form onSubmit={handleSend} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select
              value={provider}
              onChange={(e) => {
                const prov = e.target.value as ChannelProvider;
                setProvider(prov);
                if (prov.startsWith('EMAIL')) {
                  setRecipient(contact.email || '');
                } else if (prov === 'WHATSAPP_META') {
                  setRecipient(contact.phone || '');
                }
              }}
              containerClassName="w-44"
              options={[
                { value: 'WHATSAPP_META', label: 'WhatsApp Meta' },
                { value: 'TELEGRAM', label: 'Telegram Bot' },
                { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
                { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
              ]}
            />

            <Input
              placeholder="Recipient (Email/Phone/ID)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="flex-1 min-w-[200px] text-sm"
            />
          </div>

          {isEmail && (
            <Input
              placeholder="Email Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-sm"
            />
          )}

          <Textarea
            placeholder={`Type a message via ${provider === 'WHATSAPP_META' ? 'WhatsApp' : provider === 'TELEGRAM' ? 'Telegram' : 'Email'}...`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full resize-none text-sm"
          />

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isSending || !body.trim()}
              loading={isSending}
            >
              <Send className="size-4" />
              Send Message
            </Button>
          </div>
        </form>
      </Card>

      {/* Messages Timeline Feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-ink">Message History</h4>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : isError ? (
          <EmptyState
            title="Could not load messages"
            description={error instanceof Error ? error.message : 'Please try again.'}
          />
        ) : sortedMessages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-8" />}
            title="No messages yet"
            description={`No WhatsApp, Telegram, or Email messages recorded for ${contact.fullName}.`}
          />
        ) : (
          <div className="space-y-3">
            {sortedMessages.map((msg) => {
              const isOutbound = msg.direction === 'OUTBOUND';
              return (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-3.5 text-sm transition-colors ${
                    isOutbound
                      ? 'border-brand/30 bg-brand-soft/30 ml-4'
                      : 'border-border bg-surface mr-4'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={isOutbound ? 'brand' : 'neutral'}>
                        {isOutbound ? 'OUTBOUND' : 'INBOUND'}
                      </Badge>
                      <ChannelBadge provider={msg.provider} />
                      <span className="text-xs font-medium text-ink-muted">
                        {isOutbound ? `To: ${msg.recipient}` : `From: ${msg.sender}`}
                      </span>
                    </div>
                    <span className="text-xs text-ink-subtle">
                      {formatRelative(msg.createdAt)}
                    </span>
                  </div>

                  {msg.metadata?.subject && (
                    <p className="text-xs font-semibold text-ink mb-1">
                      Subject: {msg.metadata.subject}
                    </p>
                  )}

                  <p className="text-ink whitespace-pre-wrap break-words">{msg.body}</p>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink-subtle border-t border-border/40 pt-1.5">
                    <span>Status: <strong className="capitalize text-ink-muted">{msg.status}</strong></span>
                    {msg.metadata?.externalId && (
                      <span>ID: {msg.metadata.externalId}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
