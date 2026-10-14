'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PERMISSIONS } from '@saas/shared';
import type { AssistantPageContext } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { pageContextFor } from './page-context';

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pageContext: AssistantPageContext | null;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { check } = useSession();
  const allowed = check({ permission: PERMISSIONS.ASSISTANT_USE });
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const pageContext = useMemo(() => pageContextFor(pathname), [pathname]);

  // The full page shows the same thread; never mount both.
  const onAssistantPage = pathname === '/assistant' || pathname.startsWith('/assistant/');
  useEffect(() => {
    if (!allowed) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        if (!onAssistantPage) setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed, onAssistantPage]);

  const value = useMemo(
    () => ({ open: open && !onAssistantPage, setOpen, conversationId, setConversationId, pageContext }),
    [open, onAssistantPage, conversationId, pageContext],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return value;
}
