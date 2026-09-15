'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotificationAction, useNotifications } from '@/hooks/use-platform';

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
};

/**
 * The bell. Clicking a notification marks it read and goes where it points;
 * things that are dealt with elsewhere (a quote approved by someone else) clear
 * themselves on the server.
 */
export function NotificationBell() {
  const router = useRouter();
  const { data } = useNotifications();
  const act = useNotificationAction();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !panel.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-ink-muted hover:bg-surface-muted"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-sm font-medium text-ink">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => act.mutate({ kind: 'readAll' })}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-subtle">Nothing needs you right now.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) act.mutate({ kind: 'read', id: n.id });
                      setOpen(false);
                      if (n.link) router.push(n.link);
                    }}
                    className={`block w-full px-3 py-2.5 text-left hover:bg-surface-muted ${n.readAt ? '' : 'bg-accent-soft/30'}`}
                  >
                    <p className={`text-sm ${n.readAt ? 'text-ink-muted' : 'font-medium text-ink'}`}>{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-subtle">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-ink-subtle">{ago(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
