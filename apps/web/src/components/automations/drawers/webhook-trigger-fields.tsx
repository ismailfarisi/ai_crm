'use client';

import React from 'react';
import type { AutomationWorkflowDto, WebhookTriggerConfig } from '@saas/shared';
import { API_PUBLIC_URL } from '@/lib/api/config';

/** `regenerateSignature` is transient: the page lifts it out of triggerConfig when saving. */
export type WebhookTriggerEdit = WebhookTriggerConfig & { regenerateSignature?: boolean };

export interface WebhookTriggerFieldsProps {
  workflow: Pick<AutomationWorkflowDto, 'status' | 'webhookSlug'>;
  config: WebhookTriggerEdit;
  onChange: (config: WebhookTriggerEdit) => void;
  onRegenerate?: () => void | Promise<unknown>;
}

function copy(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}

export function WebhookTriggerFields({ workflow, config, onChange, onRegenerate }: WebhookTriggerFieldsProps) {
  const slug = workflow.webhookSlug;
  const url = slug ? `${API_PUBLIC_URL}/automations/webhook/${slug}` : null;
  const requireSignature = config.requireSignature === true;

  const handleRegenerate = async () => {
    const ok = window.confirm(
      'Replace the webhook address? The current address stops working immediately.',
    );
    if (!ok) return;
    try {
      await onRegenerate?.();
    } catch {
      /* the mutation reports its own error */
    }
  };

  const handleRegenerateSecret = () => {
    const ok = window.confirm(
      'Replace the signature secret? Senders using the current secret will be rejected until they switch.',
    );
    if (ok) onChange({ ...config, regenerateSignature: true });
  };

  const patch = (next: Partial<WebhookTriggerEdit>) => onChange({ ...config, ...next });

  return (
    <div data-testid="webhook-trigger-fields" className="space-y-3 pt-2 border-t border-border/40">
      <label htmlFor="webhook-url" className="text-[11px] font-medium text-ink">Webhook address</label>
      <div className="flex gap-1">
        <input
          type="text"
          readOnly
          id="webhook-url"
          data-testid="webhook-url"
          value={url ?? ''}
          placeholder="Hidden — ask someone who can edit this automation"
          className="min-w-0 flex-1 rounded-lg bg-surface-muted border border-border px-3 py-1.5 text-xs font-mono text-ink-muted"
        />
        {url && (
          <>
            <button type="button" onClick={() => copy(url)} className="rounded-lg border border-border px-2 text-xs text-ink">
              Copy
            </button>
            {onRegenerate && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="rounded-lg border border-border px-2 text-xs text-ink"
              >
                Regenerate
              </button>
            )}
          </>
        )}
      </div>
      {workflow.status !== 'ACTIVE' && (
        <p data-testid="webhook-inactive-hint" className="text-[10px] text-ink-muted">
          Switch the automation on to start receiving
        </p>
      )}

      {url && (
        <>
          <label className="flex items-center gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              data-testid="webhook-require-signature"
              checked={requireSignature}
              onChange={(e) => patch({ requireSignature: e.target.checked })}
            />
            Require a signature
          </label>
          {requireSignature && (
            <div className="space-y-1">
              {config.signatureSecret ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    readOnly
                    data-testid="webhook-secret"
                    value={config.signatureSecret}
                    className="min-w-0 flex-1 rounded-lg bg-surface-muted border border-border px-3 py-1.5 text-xs font-mono text-ink-muted"
                  />
                  <button
                    type="button"
                    data-testid="webhook-secret-copy"
                    onClick={() => copy(config.signatureSecret!)}
                    className="rounded-lg border border-border px-2 text-xs text-ink"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    data-testid="webhook-secret-regenerate"
                    onClick={handleRegenerateSecret}
                    className="rounded-lg border border-border px-2 text-xs text-ink"
                  >
                    Regenerate
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-ink-muted">The secret is generated when you save.</p>
              )}
              {config.regenerateSignature && (
                <p data-testid="webhook-secret-pending" className="text-[10px] text-ink-muted">
                  A new secret is created when you save; it appears here afterwards.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="webhook-redirect-url" className="text-[11px] font-medium text-ink">Redirect after a form post (https)</label>
            <input
              type="url"
              id="webhook-redirect-url"
              data-testid="webhook-redirect-url"
              value={config.redirectUrl ?? ''}
              onChange={(e) => patch({ redirectUrl: e.target.value || undefined })}
              placeholder="https://example.com/thanks"
              className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-medium text-ink">Examples</p>
            <pre data-testid="webhook-curl" className="overflow-x-auto rounded-lg bg-surface-muted p-2 text-[10px] font-mono text-ink">
{`curl -X POST ${url} -H 'Content-Type: application/json' -d '{"name":"Ana"}'`}
            </pre>
            <pre data-testid="webhook-form" className="overflow-x-auto rounded-lg bg-surface-muted p-2 text-[10px] font-mono text-ink">
{`<form method="post" action="${url}">
  <input name="name" />
  <button type="submit">Send</button>
</form>`}
            </pre>
            {requireSignature && (
              <p className="text-[10px] text-ink-muted">
                Sign the raw body with HMAC-SHA256 and send it as <code>X-Kerf-Signature: sha256=&lt;hex&gt;</code>.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
