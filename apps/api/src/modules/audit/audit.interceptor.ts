import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { auditActionFor } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import {
  AUDIT_BODYLESS_PREFIXES,
  AUDIT_SKIPPED_PREFIXES,
  AUDIT_SUBJECTS,
  subjectForSegment,
} from './audit-subjects';
import { AuditService } from './audit.service';

interface WithId {
  id?: unknown;
}

/**
 * Writes the audit row for every state-changing request.
 *
 * Applied globally rather than per route, because the failure mode that
 * matters is the route somebody forgot to annotate. Reads are ignored: the
 * trail answers "what changed", and recording every GET would bury that under
 * traffic nobody will ever read.
 *
 * `before` and `after` are read from the database either side of the handler,
 * so they describe the row rather than whatever shape the controller decided
 * to return.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();

    const segments = req.path
      .replace(/^\/api\/v\d+/, '')
      .split('/')
      .filter(Boolean);
    const [head] = segments;
    if (!head || AUDIT_SKIPPED_PREFIXES.includes(head)) return next.handle();

    const action = auditActionFor(req.method, segments);
    if (!action) return next.handle();

    const user = req.user;
    // An unauthenticated write is a public route: a quote acceptance, a
    // provider webhook. Those are recorded by the services that can say which
    // tenant they belong to, since the request itself cannot.
    if (!user) return next.handle();

    const mapped = AUDIT_SUBJECTS[head];
    const bodyless = AUDIT_BODYLESS_PREFIXES.includes(head);
    const paramId = idFrom(req.params?.id) ?? idFrom(segments[1]);
    const before =
      mapped && paramId && !bodyless
        ? await this.audit.snapshot(mapped.entity, user.organizationId, paramId)
        : null;

    return next.handle().pipe(
      tap({
        next: (result) => {
          const subjectId =
            paramId ?? idFrom((result as WithId | undefined)?.id) ?? null;
          void this.write(req, user, action, head, subjectId, before, bodyless);
        },
        // A failed request changed nothing, so there is nothing to record.
      }),
    );
  }

  private async write(
    req: Request,
    user: AuthenticatedUser,
    action: string,
    head: string,
    subjectId: string | null,
    before: Record<string, unknown> | null,
    bodyless: boolean,
  ): Promise<void> {
    const mapped = AUDIT_SUBJECTS[head];
    const after =
      mapped && subjectId && !bodyless
        ? await this.audit.snapshot(
            mapped.entity,
            user.organizationId,
            subjectId,
          )
        : null;
    await this.audit.record({
      tenantId: user.organizationId,
      actorId: user.id,
      actorName: nameOf(user),
      action,
      subjectType: subjectForSegment(head),
      subjectId,
      before,
      // With no mapped entity there is still something worth keeping: what was
      // asked for. Bodies from credential routes are dropped entirely.
      after: after ?? (bodyless ? null : bodyOf(req)),
      ip: req.ip ?? null,
      origin: 'HUMAN',
      channel: 'WEB',
    });
  }
}

const idFrom = (value: unknown): string | null =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;

const nameOf = (user: AuthenticatedUser): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
  user.email;

function bodyOf(req: Request): Record<string, unknown> | null {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return Object.keys(body).length ? (body as Record<string, unknown>) : null;
}
