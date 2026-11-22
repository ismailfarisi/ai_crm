'use client';

import React from 'react';
import { AUTOMATION_MESSAGE_CHANNELS, AUTOMATION_NOTIFY_GROUPS } from '@saas/shared';
import { DataField } from './data-field';
import type { DataGroup } from '../step-wording';

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
  /** What earlier steps make available, for "Insert data". */
  groups?: DataGroup[];
}

/** "Send Message": a chat message on a connected channel. */
export function MessageStepFields({ config, onChange, groups = [] }: ShopStepFieldsProps) {
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

      <DataField
        label={toCustomer ? "Customer's number or chat" : "Colleague's email"}
        testId="message-to-input"
        groups={groups}
        value={config.to || ''}
        onChange={(v) => set('to', v)}
        placeholder={toCustomer ? 'Use Insert data to pick the customer’s phone' : 'production@yourshop.ae'}
        hint={
          <>
          {toCustomer
            ? `Only a customer who has already messaged you on ${channel.label} can be reached here, and the text must be written by you, not by an AI step. Use “Send an email” for everyone else.`
            : `The email they sign in to Kerf with. They must have linked ${channel.label} to Kerf${
                channel.value === 'SLACK' ? '; or enter a Slack channel ID such as C0123ABCD' : ''
              }. Separate several with commas.`}
          </>
        }
      />

      <DataField
        label="Message"
        testId="message-body-input"
        multiline
        rows={4}
        groups={groups}
        value={config.body || ''}
        onChange={(v) => set('body', v)}
        placeholder="Your order is ready to collect."
      />
    </div>
  );
}

/** "Notify Staff": an alert in the bell. */
export function NotifyStepFields({ config, onChange, groups = [] }: ShopStepFieldsProps) {
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

      <DataField
        label="Title"
        testId="notify-title-input"
        groups={groups}
        value={config.title || ''}
        onChange={(v) => set('title', v)}
        placeholder="Deposit paid, the job can start"
      />

      <DataField
        label="Details (optional)"
        testId="notify-body-input"
        multiline
        rows={3}
        groups={groups}
        value={config.body || ''}
        onChange={(v) => set('body', v)}
      />

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
