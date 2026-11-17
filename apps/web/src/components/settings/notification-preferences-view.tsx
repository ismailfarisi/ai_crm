'use client';

import { useState } from 'react';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationPreferencesView as PreferencesDto,
  type OrgNotificationPreferencesPayload,
  type UserNotificationPreferencesPayload,
} from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Badge, PageHeader, Skeleton } from '@/components/ui/primitives';
import {
  useNotificationPreferences,
  useResetOwnNotificationPreferences,
  useSaveOrgNotificationDefault,
  useSaveOwnNotificationPreferences,
} from '@/hooks/use-notification-preferences';

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  BELL: 'In the app',
  EMAIL: 'Email',
  CHAT: 'WhatsApp or Telegram',
};

const REMINDER_OPTIONS = [
  { minutes: 60, label: 'After 1 hour' },
  { minutes: 120, label: 'After 2 hours' },
  { minutes: 240, label: 'After 4 hours' },
  { minutes: 480, label: 'After 8 hours' },
  { minutes: 1440, label: 'After 1 day' },
];

interface Draft {
  approvalChannels: NotificationChannel[];
  outcomeChannels: NotificationChannel[];
  quiet: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai';
  } catch {
    return 'Asia/Dubai';
  }
}

export function toDraft(prefs: UserNotificationPreferencesPayload): Draft {
  return {
    approvalChannels: prefs.approvalChannels,
    outcomeChannels: prefs.outcomeChannels,
    quiet: prefs.quietHoursStart !== null,
    quietHoursStart: prefs.quietHoursStart ?? '20:00',
    quietHoursEnd: prefs.quietHoursEnd ?? '08:00',
    timezone: prefs.timezone ?? browserTimezone(),
  };
}

export function fromDraft(draft: Draft): UserNotificationPreferencesPayload {
  return {
    approvalChannels: NOTIFICATION_CHANNELS.filter((c) => draft.approvalChannels.includes(c)),
    outcomeChannels: NOTIFICATION_CHANNELS.filter((c) => draft.outcomeChannels.includes(c)),
    quietHoursStart: draft.quiet ? draft.quietHoursStart : null,
    quietHoursEnd: draft.quiet ? draft.quietHoursEnd : null,
    timezone: draft.quiet ? draft.timezone.trim() || null : null,
  };
}

function toggle(list: NotificationChannel[], channel: NotificationChannel, on: boolean) {
  return on ? [...new Set([...list, channel])] : list.filter((c) => c !== channel);
}

function ChannelRow({
  id,
  title,
  hint,
  value,
  onChange,
  chatLinked,
}: {
  id: string;
  title: string;
  hint: string;
  value: NotificationChannel[];
  onChange: (next: NotificationChannel[]) => void;
  chatLinked: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{title}</legend>
      <p className="text-xs text-ink-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_CHANNELS.map((channel) => {
          const inputId = `${id}-${channel}`;
          return (
            <label
              key={channel}
              htmlFor={inputId}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-surface px-3 py-2 text-sm text-ink has-[:checked]:border-brand/50 has-[:checked]:bg-brand-soft"
            >
              <input
                id={inputId}
                type="checkbox"
                className="size-4 rounded border-border accent-brand"
                checked={value.includes(channel)}
                onChange={(e) => onChange(toggle(value, channel, e.target.checked))}
              />
              {CHANNEL_LABEL[channel]}
              {channel === 'CHAT' && !chatLinked && <Badge tone="neutral">Not linked</Badge>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function PreferencesForm({
  id,
  draft,
  setDraft,
  chatLinked,
  children,
}: {
  id: string;
  draft: Draft;
  setDraft: (next: Draft) => void;
  chatLinked: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <ChannelRow
        id={`${id}-approvals`}
        title="Something needs approval"
        hint="Quotes, automation steps and AI actions you can approve. One reminder if it is still waiting."
        value={draft.approvalChannels}
        onChange={(approvalChannels) => setDraft({ ...draft, approvalChannels })}
        chatLinked={chatLinked}
      />
      <ChannelRow
        id={`${id}-outcomes`}
        title="Your request was decided"
        hint="When something you sent for approval is approved or rejected."
        value={draft.outcomeChannels}
        onChange={(outcomeChannels) => setDraft({ ...draft, outcomeChannels })}
        chatLinked={chatLinked}
      />
      {children}
      <div className="space-y-3">
        <label htmlFor={`${id}-quiet`} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
          <input
            id={`${id}-quiet`}
            type="checkbox"
            className="size-4 rounded border-border accent-brand"
            checked={draft.quiet}
            onChange={(e) => setDraft({ ...draft, quiet: e.target.checked })}
          />
          Quiet hours: hold email and chat messages
        </label>
        {draft.quiet && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="From"
              type="time"
              value={draft.quietHoursStart}
              onChange={(e) => setDraft({ ...draft, quietHoursStart: e.target.value })}
              required
            />
            <Input
              label="Until"
              type="time"
              value={draft.quietHoursEnd}
              onChange={(e) => setDraft({ ...draft, quietHoursEnd: e.target.value })}
              required
            />
            <Input
              label="Time zone"
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              placeholder="Asia/Dubai"
            />
          </div>
        )}
        {draft.quiet && (
          <p className="text-xs text-ink-muted">The in-app bell still shows at once. Held messages go out when quiet hours end.</p>
        )}
      </div>
    </div>
  );
}

function OwnPreferences({ view }: { view: PreferencesDto }) {
  const save = useSaveOwnNotificationPreferences();
  const reset = useResetOwnNotificationPreferences();
  const [draft, setDraft] = useState(() => toDraft(view.effective));
  const [synced, setSynced] = useState(view);
  if (synced !== view) {
    setSynced(view);
    setDraft(toDraft(view.effective));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(fromDraft(draft));
      }}
      className="space-y-5 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Your notifications</h2>
        {view.own ? <Badge tone="info">Your own choice</Badge> : <Badge tone="neutral">Organisation default</Badge>}
      </div>
      {view.linkedChats.length === 0 && (
        <p className="text-xs text-ink-muted">
          Chat messages need your WhatsApp or Telegram linked to Kerf. Ask an admin for a link code.
        </p>
      )}
      <PreferencesForm id="own" draft={draft} setDraft={setDraft} chatLinked={view.linkedChats.length > 0} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
        {view.own && (
          <Button type="button" variant="outline" loading={reset.isPending} onClick={() => reset.mutate()}>
            Use organisation default
          </Button>
        )}
      </div>
    </form>
  );
}

function OrgDefault({ view }: { view: PreferencesDto }) {
  const save = useSaveOrgNotificationDefault();
  const [draft, setDraft] = useState(() => toDraft(view.orgDefault));
  const [delay, setDelay] = useState(view.orgDefault.reminderDelayMinutes);
  const [synced, setSynced] = useState(view);
  if (synced !== view) {
    setSynced(view);
    setDraft(toDraft(view.orgDefault));
    setDelay(view.orgDefault.reminderDelayMinutes);
  }
  const options = REMINDER_OPTIONS.some((o) => o.minutes === delay)
    ? REMINDER_OPTIONS
    : [...REMINDER_OPTIONS, { minutes: delay, label: `After ${delay} minutes` }];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload: OrgNotificationPreferencesPayload = { ...fromDraft(draft), reminderDelayMinutes: delay };
        save.mutate(payload);
      }}
      className="space-y-5 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-ink">Organisation default</h2>
        <p className="text-xs text-ink-muted">Applies to everyone who has not made their own choice.</p>
      </div>
      <PreferencesForm id="org" draft={draft} setDraft={setDraft} chatLinked>
        <Select
          label="Remind approvers"
          value={String(delay)}
          onChange={(e) => setDelay(Number(e.target.value))}
          hint="Automation steps that time out sooner are reminded before they expire."
          containerClassName="max-w-xs"
          options={options.map((o) => ({ value: String(o.minutes), label: o.label }))}
        />
      </PreferencesForm>
      <Button type="submit" loading={save.isPending}>
        Save default
      </Button>
    </form>
  );
}

export function NotificationPreferencesView() {
  const { data: view, isPending, isError } = useNotificationPreferences();

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Choose how Kerf tells you about approvals." />
      {isPending ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : isError || !view ? (
        <p className="text-sm text-danger">Could not load your notification settings.</p>
      ) : (
        <>
          <OwnPreferences view={view} />
          {view.canEditOrgDefault && <OrgDefault view={view} />}
        </>
      )}
    </div>
  );
}
