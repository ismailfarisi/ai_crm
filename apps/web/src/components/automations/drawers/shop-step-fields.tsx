'use client';

import React from 'react';
import { AUTOMATION_MESSAGE_CHANNELS, AUTOMATION_NOTIFY_GROUPS } from '@saas/shared';

const selectClass =
  'w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted';
const inputClass =
  'w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none';
const labelClass = 'text-[11px] font-medium text-ink';
const hintClass = 'text-[11px] text-ink-muted leading-snug';

/** Every field of these two steps is text. */
type StepConfig = Record<string, string | undefined>;

export interface ShopStepFieldsProps {
  config: StepConfig;
  onChange: (config: StepConfig) => void;
}

/** "Send Message": a chat message on a connected channel. */
export function MessageStepFields({ config, onChange }: ShopStepFieldsProps) {
  const set = (key: string, value: string) => onChange({ ...config, [key]: value });
  const toCustomer = config.audience === 'customer';
  const channel =
    AUTOMATION_MESSAGE_CHANNELS.find((c) => c.value === config.channel) ?? AUTOMATION_MESSAGE_CHANNELS[0];

  return (
    <div className="space-y-3 pt-2 border-t border-border/40">
      <div className="space-y-1">
        <label className={labelClass}>Channel</label>
        <select
          data-testid="message-channel-select"
          value={channel.value}
          onChange={(e) => set('channel', e.target.value)}
          className={selectClass}
        >
          {AUTOMATION_MESSAGE_CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <p className={hintClass}>The channel must be connected under Settings → Channels.</p>
      </div>

      <div className="space-y-1">
        <label className={labelClass}>Send to</label>
        <select
          data-testid="message-audience-select"
          value={toCustomer ? 'customer' : 'staff'}
          onChange={(e) => set('audience', e.target.value)}
          className={selectClass}
        >
          <option value="staff">A colleague</option>
          <option value="customer">A customer</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className={labelClass}>{toCustomer ? "Customer's number or chat" : "Colleague's email"}</label>
        <input
          type="text"
          data-testid="message-to-input"
          value={config.to || ''}
          onChange={(e) => set('to', e.target.value)}
          placeholder={toCustomer ? '{{ $trigger.payload.customerPhone }}' : 'production@yourshop.ae'}
          className={inputClass}
        />
        <p className={hintClass}>
          {toCustomer
            ? `Only a customer who has already messaged you on ${channel.label} can be reached here, and the text must be written by you, not by an AI step. Use Send Email for everyone else.`
            : `The email they sign in to Kerf with. They must have linked ${channel.label} to Kerf${
                channel.value === 'SLACK' ? '; or enter a Slack channel ID such as C0123ABCD' : ''
              }. Separate several with commas.`}
        </p>
      </div>

      <div className="space-y-1">
        <label className={labelClass}>Message</label>
        <textarea
          data-testid="message-body-input"
          value={config.body || ''}
          onChange={(e) => set('body', e.target.value)}
          rows={4}
          placeholder="Your order {{ $trigger.payload.orderNumber }} is ready to collect."
          className={inputClass}
        />
      </div>
    </div>
  );
}

/** "Notify Staff": an alert in the bell. */
export function NotifyStepFields({ config, onChange }: ShopStepFieldsProps) {
  const set = (key: string, value: string) => onChange({ ...config, [key]: value });
  const toPerson = config.audience === 'person';

  return (
    <div className="space-y-3 pt-2 border-t border-border/40">
      <div className="space-y-1">
        <label className={labelClass}>Who to notify</label>
        <select
          data-testid="notify-audience-select"
          value={toPerson ? 'person' : 'group'}
          onChange={(e) => set('audience', e.target.value)}
          className={selectClass}
        >
          <option value="group">A team</option>
          <option value="person">Named people</option>
        </select>
      </div>

      {toPerson ? (
        <div className="space-y-1">
          <label className={labelClass}>Their email</label>
          <input
            type="text"
            data-testid="notify-to-input"
            value={config.to || ''}
            onChange={(e) => set('to', e.target.value)}
            placeholder="buyer@yourshop.ae"
            className={inputClass}
          />
          <p className={hintClass}>The email they sign in to Kerf with. Separate several with commas.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <label className={labelClass}>Team</label>
          <select
            data-testid="notify-group-select"
            value={config.group || ''}
            onChange={(e) => set('group', e.target.value)}
            className={selectClass}
          >
            <option value="">Choose…</option>
            {AUTOMATION_NOTIFY_GROUPS.map((group) => (
              <option key={group.value} value={group.value}>
                {group.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>Everyone whose role lets them do that work gets the alert.</p>
        </div>
      )}

      <div className="space-y-1">
        <label className={labelClass}>Title</label>
        <input
          type="text"
          data-testid="notify-title-input"
          value={config.title || ''}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Deposit paid for {{ $trigger.payload.orderNumber }}"
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label className={labelClass}>Details (optional)</label>
        <textarea
          data-testid="notify-body-input"
          value={config.body || ''}
          onChange={(e) => set('body', e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label className={labelClass}>Page to open (optional)</label>
        <input
          type="text"
          data-testid="notify-link-input"
          value={config.link || ''}
          onChange={(e) => set('link', e.target.value)}
          placeholder="/production"
          className={inputClass}
        />
      </div>
    </div>
  );
}
