'use client';

import { useState } from 'react';
import { CheckCircle2, ExternalLink, MessageCircle, Smartphone } from 'lucide-react';
import type { WhatsAppSendResultDto } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

/** "971501234567" → "+971501234567". */
const plus = (digits: string) => `+${digits}`;

export function SendOnWhatsAppButton({
  what,
  customerName,
  send,
  disabled,
  size = 'md',
}: {
  /** What is being sent, in the dialog title: "Q-0012", "artwork proof v2", "invoice INV-0007". */
  what: string;
  customerName: string | null;
  send: (to: string | null) => Promise<WhatsAppSendResultDto>;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhatsAppSendResultDto | null>(null);

  const close = () => {
    setOpen(false);
    setResult(null);
    setError(null);
    setTo('');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await send(to.trim() || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  const customer = customerName || 'the customer';
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="size-4" aria-hidden />
        Send on WhatsApp
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={result ? resultTitle(result) : `Send ${what} to ${customer} on WhatsApp?`}
        description={
          result
            ? undefined
            : 'Your business WhatsApp number sends it when WhatsApp allows. If it cannot, WhatsApp opens on your own phone or computer with the message ready to send.'
        }
        size="sm"
        footer={
          result ? (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              {result.chatUrl && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => window.open(result.chatUrl!, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Open WhatsApp
                </Button>
              )}
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" variant="primary" loading={busy} onClick={submit}>
                <MessageCircle className="size-4" aria-hidden />
                Send on WhatsApp
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-3 text-sm">
            {result.method === 'CHANNEL' ? (
              <p className="flex items-start gap-2 text-ink">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>
                  Sent from your business WhatsApp number to {plus(result.to)}
                  {result.usedTemplate ? ' as your approved message template' : ''}. It is in the
                  conversation with {customer} in the inbox.
                </span>
              </p>
            ) : (
              <>
                <p className="flex items-start gap-2 text-ink">
                  <Smartphone className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    Not sent yet. Press “Open WhatsApp” to send it to {plus(result.to)} from your own
                    WhatsApp; it will not appear in the inbox.
                  </span>
                </p>
                {result.reason && <p className="text-ink-muted">{result.reason}</p>}
              </>
            )}
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-surface-subtle p-3 text-ink-muted">
              {result.text}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              label="Mobile number (optional)"
              placeholder="+971 50 123 4567"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              hint={`Leave empty to use the phone number on ${customer}.`}
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function resultTitle(result: WhatsAppSendResultDto): string {
  return result.method === 'CHANNEL' ? 'Sent on WhatsApp' : 'Send it from your own WhatsApp';
}
