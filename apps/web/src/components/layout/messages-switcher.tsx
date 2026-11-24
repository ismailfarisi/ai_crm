'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { cn } from '@/lib/utils';

/**
 * Inbox, Email and Assistant are three different places that all look like
 * "messages". This strip names what each one is for and moves between them.
 */
export const MESSAGE_PLACES = [
  {
    href: '/inbox',
    label: 'Inbox',
    icon: MessageSquare,
    permission: PERMISSIONS.CHANNEL_READ,
    hint: 'Customers writing to your business on WhatsApp, Telegram, website chat or your shared address. Shared with the team.',
  },
  {
    href: '/email',
    label: 'Email',
    icon: Mail,
    permission: PERMISSIONS.EMAIL_READ,
    hint: 'Your own connected mailbox, to read and send email.',
  },
  {
    href: '/assistant',
    label: 'Assistant',
    icon: MessageCircle,
    permission: PERMISSIONS.ASSISTANT_USE,
    hint: 'Your private chat with the AI. Customers never see it.',
  },
] as const;

export function MessagesSwitcher() {
  const { can } = useSession();
  const pathname = usePathname();
  const places = MESSAGE_PLACES.filter((p) => can(p.permission));
  const current = places.find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      {places.length > 1 && (
        <nav aria-label="Messages" className="flex rounded-full border border-border bg-surface p-0.5">
          {places.map((p) => {
            const Icon = p.icon;
            const active = p === current;
            return (
              <Link
                key={p.href}
                href={p.href}
                title={p.hint}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                  active ? 'bg-charcoal text-on-charcoal' : 'text-ink-muted hover:text-ink',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {p.label}
              </Link>
            );
          })}
        </nav>
      )}
      {current && <p className="text-xs text-ink-muted">{current.hint}</p>}
    </div>
  );
}
