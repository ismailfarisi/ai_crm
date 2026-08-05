'use client';

import type { ReactNode } from 'react';
import type { AccessRule } from '@/lib/access';
import { useSession } from '@/lib/session-context';

interface CanProps extends AccessRule {
  /**
   * Normally the subtree to show when allowed. Pass a function instead to
   * render either way and decide yourself — the usual reason is disabling a
   * control rather than hiding it, so the user can see the feature exists.
   */
  children: ReactNode | ((allowed: boolean) => ReactNode);
  /** Rendered when denied. Ignored when `children` is a function. */
  fallback?: ReactNode;
}

/**
 * Hides (or disables) UI the user cannot act on.
 *
 *   <Can permission={PERMISSIONS.CONTACT_CREATE}>
 *     <Button>New contact</Button>
 *   </Can>
 *
 *   <Can permission={PERMISSIONS.CONTACT_DELETE}>
 *     {(allowed) => <Button disabled={!allowed}>Delete</Button>}
 *   </Can>
 *
 * Presentation only. The API enforces the same rule on every request, so a
 * hidden button is a courtesy — never the security boundary.
 */
export function Can({ children, fallback = null, ...rule }: CanProps) {
  const { check } = useSession();
  const allowed = check(rule);

  if (typeof children === 'function') {
    return <>{children(allowed)}</>;
  }

  return <>{allowed ? children : fallback}</>;
}
