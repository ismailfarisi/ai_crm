import Link from 'next/link';
import { Lock } from 'lucide-react';
import { describeRule, type AccessRule } from '@/lib/access';
import { Card, CardBody } from '@/components/ui/primitives';

interface NoAccessProps {
  rule?: AccessRule;
  title?: string;
  /** Hidden when this renders inline inside an already-navigable page. */
  showHomeLink?: boolean;
}

/**
 * Shown instead of a screen the user may not see.
 *
 * It names the missing permission on purpose: "ask an admin for X" is a request
 * someone can act on, where a bare "Access denied" just sends them to support.
 * The permission catalog is not sensitive — the API returns it to anyone who can
 * open the role editor, and knowing a permission's name grants nothing.
 */
export function NoAccess({ rule, title = "You don't have access to this", showHomeLink = true }: NoAccessProps) {
  const requirements = rule ? describeRule(rule) : [];

  return (
    <Card>
      <CardBody className="flex flex-col items-center px-6 py-14 text-center">
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-surface-muted text-ink-subtle">
          <Lock className="size-5" aria-hidden />
        </span>

        <h1 className="text-base font-semibold text-ink">{title}</h1>

        {requirements.length > 0 ? (
          <div className="mt-2 max-w-md text-sm text-ink-muted">
            <p>Your role doesn&apos;t include:</p>
            <ul className="mt-2 space-y-1">
              {requirements.map((requirement) => (
                <li key={requirement} className="text-ink">
                  {requirement}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 max-w-md text-sm text-ink-muted">
            Your role doesn&apos;t include access to this area.
          </p>
        )}

        <p className="mt-4 max-w-md text-sm text-ink-subtle">
          If you think this is wrong, ask an administrator to update your role.
        </p>

        {showHomeLink && (
          <Link
            href="/dashboard"
            className="mt-6 text-sm font-medium text-brand hover:underline"
          >
            Back to dashboard
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
