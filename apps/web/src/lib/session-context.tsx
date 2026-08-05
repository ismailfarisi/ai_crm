'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, SessionDto } from '@saas/shared';
import { api, queryKeys } from './api/endpoints';
import { checkAccess, subjectFromSession, type AccessRule, type AccessSubject } from './access';

interface SessionContextValue {
  session: SessionDto;
  subject: AccessSubject;
  /** The general form — takes the same rule object the server guards use. */
  check: (rule: AccessRule) => boolean;
  /** True when the user holds every listed permission. */
  can: (...permissions: Permission[]) => boolean;
  /** True when the user holds at least one of the listed permissions. */
  canAny: (...permissions: Permission[]) => boolean;
  hasRole: (...slugs: string[]) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The session is fetched on the server and passed in as `initialSession`, so the
 * first paint already knows who the user is. React Query keeps it fresh
 * afterwards — a role change is picked up on the next refetch without a reload.
 */
export function SessionProvider({
  initialSession,
  children,
}: {
  initialSession: SessionDto;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: session } = useQuery({
    queryKey: queryKeys.session,
    queryFn: api.auth.me,
    initialData: initialSession,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const subject = useMemo(() => subjectFromSession(session), [session]);

  const check = useCallback((rule: AccessRule) => checkAccess(subject, rule), [subject]);

  const can = useCallback(
    (...permissions: Permission[]) => checkAccess(subject, { permission: permissions }),
    [subject],
  );

  const canAny = useCallback(
    (...permissions: Permission[]) => checkAccess(subject, { anyOf: permissions }),
    [subject],
  );

  const hasRole = useCallback(
    (...slugs: string[]) => checkAccess(subject, { role: slugs }),
    [subject],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }, [queryClient]);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
    router.refresh();
  }, [queryClient, router]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, subject, check, can, canAny, hasRole, refresh, logout }),
    [session, subject, check, can, canAny, hasRole, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside the authenticated layout');
  }
  return context;
}

/**
 * `const canDelete = useCan({ permission: PERMISSIONS.CONTACT_DELETE })`
 *
 * For when you need the boolean itself — to disable a control, pick a label, or
 * skip a query — rather than to hide a subtree.
 */
export function useCan(rule: AccessRule): boolean {
  return useSession().check(rule);
}
