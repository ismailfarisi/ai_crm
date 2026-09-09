'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, Trash2 } from 'lucide-react';
import { api, queryKeys } from '@/lib/api/endpoints';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';

const PROVIDER_LABELS: Record<string, string> = {
  WHATSAPP_META: 'WhatsApp',
  TELEGRAM: 'Telegram',
  EMAIL_SMTP: 'Email (SMTP)',
  EMAIL_RESEND: 'Email (Resend)',
};

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function useCountdown(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return 'Expired';
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ChannelIdentityLinking() {
  const queryClient = useQueryClient();
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const countdown = useCountdown(generatedCode?.expiresAt ?? null);

  const { data: identities = [] } = useQuery({
    queryKey: queryKeys.channelIdentities,
    queryFn: api.channels.identities.list,
  });

  const createCode = useMutation({
    mutationFn: api.channels.identities.createLinkCode,
    onSuccess: (result) => setGeneratedCode(result),
    onError: (error) => toast.error(describe(error, 'Could not generate a linking code')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.channels.identities.revoke(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.channelIdentities });
      toast.success('Identity unlinked');
    },
    onError: (error) => toast.error(describe(error, 'Could not unlink that identity')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat Commands</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Link your Telegram, WhatsApp, or email to approve quotes (and generate their invoices)
          just by messaging your organization&apos;s connected channel.
        </p>

        {generatedCode && countdown !== 'Expired' ? (
          <div className="rounded-xl border border-border/40 bg-surface-muted/40 p-4 space-y-2">
            <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
              Your linking code (expires in {countdown})
            </p>
            <p className="font-mono text-2xl font-bold text-ink tracking-widest">{generatedCode.code}</p>
            <p className="text-xs text-ink-subtle">
              Send this exact code as a message on the Telegram, WhatsApp, or email channel you
              want to link — from the number/address you personally use.
            </p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => createCode.mutate()}
            disabled={createCode.isPending}
          >
            <Link2 className="size-3.5" />
            {createCode.isPending ? 'Generating...' : 'Generate linking code'}
          </Button>
        )}

        {identities.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/25">
            <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase pt-2">
              Linked identities
            </p>
            {identities.map((identity) => (
              <div
                key={identity.id}
                className="flex items-center justify-between rounded-lg border border-border/30 px-3 py-2 text-sm"
              >
                <span className="text-ink">
                  {PROVIDER_LABELS[identity.provider] ?? identity.provider} —{' '}
                  <span className="font-mono text-ink-muted">{identity.identifierPreview}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke.mutate(identity.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
