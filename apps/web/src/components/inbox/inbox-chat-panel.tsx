'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Mail, MessageSquare, Phone, User, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { type ChannelProvider } from '@saas/shared';
import { api, type ChannelMessageDto } from '@/lib/api/endpoints';
import { formatRelative, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge, Card } from '@/components/ui/primitives';
import type { ThreadGroup } from './inbox-thread-list';

interface InboxChatPanelProps {
  thread: ThreadGroup | null;
  onMessageSent: () => void;
}

export function InboxChatPanel({ thread, onMessageSent }: InboxChatPanelProps) {
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
  }, [thread]);

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
        <h3 className="text-base font-semibold text-ink">No conversation selected</h3>
        <p className="mt-1 text-sm text-ink-subtle max-w-sm">
          Select a thread from the list on the left to view message history and send replies.
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

      toast.success('Message sent successfully');
      setBody('');
      setSubject('');
      onMessageSent();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Thread Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand ring-1 ring-brand/20">
            {initials(thread.name, '')}
          </div>
          <div>
            <h3 className="font-semibold text-ink leading-none">{thread.name}</h3>
            <p className="text-xs text-ink-subtle mt-1">
              {thread.contact?.email || thread.contact?.phone || thread.recipientOrSender}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {Array.from(thread.providers).map((prov) => (
            <Badge key={prov} tone={prov === 'WHATSAPP_META' ? 'success' : prov === 'TELEGRAM' ? 'brand' : 'warning'}>
              {prov === 'WHATSAPP_META' ? 'WhatsApp' : prov === 'TELEGRAM' ? 'Telegram' : 'Email'}
            </Badge>
          ))}
        </div>
      </div>

      {/* Message History Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-surface-muted/10">
        {sortedMessages.length === 0 ? (
          <p className="text-center text-sm text-ink-subtle py-8">No messages in this conversation.</p>
        ) : (
          sortedMessages.map((msg) => {
            const isOutbound = msg.direction === 'OUTBOUND';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                    isOutbound
                      ? 'bg-brand text-white rounded-br-xs'
                      : 'bg-surface border border-border text-ink rounded-bl-xs'
                  }`}
                >
                  {/* Subject line for email messages */}
                  {msg.metadata?.subject && (
                    <p className={`font-semibold mb-1 text-xs ${isOutbound ? 'text-white/90' : 'text-ink-subtle'}`}>
                      Subject: {msg.metadata.subject}
                    </p>
                  )}

                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>

                  <div
                    className={`mt-1.5 flex items-center justify-end gap-1.5 text-[10px] ${
                      isOutbound ? 'text-white/80' : 'text-ink-subtle'
                    }`}
                  >
                    <span>{msg.provider === 'WHATSAPP_META' ? 'WhatsApp' : msg.provider === 'TELEGRAM' ? 'Telegram' : 'Email'}</span>
                    <span>•</span>
                    <span>{formatRelative(msg.createdAt)}</span>
                    <span>•</span>
                    <span className="capitalize font-medium">{msg.status}</span>
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
            value={provider}
            onChange={(e) => setProvider(e.target.value as ChannelProvider)}
            containerClassName="w-44"
            options={[
              { value: 'WHATSAPP_META', label: 'WhatsApp Meta' },
              { value: 'TELEGRAM', label: 'Telegram Bot' },
              { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
              { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
            ]}
          />

          {/* Recipient Input */}
          <Input
            placeholder="Recipient (Phone / Email / Chat ID)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
        </div>

        {/* Subject input (if email) */}
        {isEmail && (
          <Input
            placeholder="Email Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full text-sm"
          />
        )}

        {/* Message body */}
        <div className="relative flex items-end gap-2">
          <Textarea
            placeholder={`Type your reply via ${provider === 'WHATSAPP_META' ? 'WhatsApp' : provider === 'TELEGRAM' ? 'Telegram' : 'Email'}...`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="flex-1 resize-none text-sm pr-12"
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
            size="md"
            className="self-end"
          >
            <Send className="size-4" />
            Send
          </Button>
        </div>
        <p className="text-[11px] text-ink-subtle text-right">Press Ctrl+Enter or Cmd+Enter to send</p>
      </form>
    </div>
  );
}
