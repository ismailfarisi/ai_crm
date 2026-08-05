import 'server-only';
import type { ReactNode } from 'react';
import { checkAccess, type AccessRule } from '@/lib/access';
import { getAccessSubject } from '@/lib/get-session';
import { NoAccess } from './no-access';

interface PageGuardProps extends AccessRule {
  children: ReactNode;
  /** Override the denial heading, e.g. "You can't manage roles". */
  title?: string;
}

/**
 * Route-level gate for a server-rendered page.
 *
 * Hiding a nav link is not access control: anyone can type the URL. Without
 * this, an unauthorized visitor renders the whole screen, fires its queries,
 * and gets a wall of 403 toasts instead of an answer. Guarding on the server
 * means the page never renders and never requests data it cannot have.
 *
 * The session read is request-cached, so this costs nothing beyond the fetch
 * the layout already made.
 */
export async function PageGuard({ children, title, ...rule }: PageGuardProps) {
  const subject = await getAccessSubject();

  if (!checkAccess(subject, rule)) {
    return <NoAccess rule={rule} title={title} />;
  }

  return <>{children}</>;
}
