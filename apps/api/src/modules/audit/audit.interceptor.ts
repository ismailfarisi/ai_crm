import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, concatMap } from 'rxjs';
import { auditActionFor } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import {
  AUDIT_BODYLESS_PREFIXES,
  AUDIT_SKIPPED_PREFIXES,
  AUDIT_SUBJECTS,
  auditSubjectFor,
  labelForRecord,
  redactBody,
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
 * to return. `after` is read the moment the handler returns, and the row is
 * written before the response is released, so the client cannot have sent a
 * follow-up change that the snapshot then captures by mistake.
 *
 * What this guarantees, and what it does not:
 * - The response waits for the audit write. A process that dies after the
 *   handler committed but before the write finished loses that row — but that
 *   window is now the length of one insert, not "whenever the event loop gets
 *   round to it".
 * - If the insert fails, `AuditService.record` queues the row in the outbox
 *   and the dispatcher retries it. Only when the outbox write fails too (the
 *   database is unreachable) is the row dropped, and logged.
 * - The audit row is not in the handler's transaction — an interceptor cannot
 *   reach it — so the change and its audit row are not atomic. That is the
 *   residual gap; closing it means recording from inside each service.
 * - An audit failure never fails the user's request: the change has happened.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

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

    const subject = auditSubjectFor(segments);
    const mapped = subject.mapped;
    const bodyless = AUDIT_BODYLESS_PREFIXES.includes(head);
    const paramId =
      idFrom(req.params?.id) ??
      idFrom(subject.idSegment) ??
      (mapped?.singleton && !bodyless
        ? idFrom(
            await this.audit.singletonId(mapped.entity, user.organizationId),
          )
        : null);
    const before =
      mapped && paramId && !bodyless
        ? await this.audit.snapshot(mapped.entity, user.organizationId, paramId)
        : null;

    return next.handle().pipe(
      // A failed request changed nothing, so there is nothing to record: an
      // error skips this and propagates untouched.
      concatMap(async (result) => {
        const subjectId =
          paramId ?? idFrom((result as WithId | undefined)?.id) ?? null;
        try {
          await this.write(
            req,
            user,
            action,
            subject.key,
            subjectId,
            before,
            bodyless,
          );
        } catch (error) {
          // `record` and `snapshot` do not throw; this is belt and braces so
          // the trail can never turn a completed change into a 500.
          this.logger.error(
            `Audit write failed for ${action}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return result;
      }),
    );
  }

  private async write(
    req: Request,
    user: AuthenticatedUser,
    action: string,
    key: string,
    subjectId: string | null,
    before: Record<string, unknown> | null,
    bodyless: boolean,
  ): Promise<void> {
    const mapped = AUDIT_SUBJECTS[key];
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
      subjectType: subjectForSegment(key),
      subjectId,
      // Which record this was. Taken from `after` first: a rename should be
      // filed under the name the record now has. Falls back to `before` so a
      // delete still says what was deleted.
      summary: labelForRecord(after) ?? labelForRecord(before),
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
  return Object.keys(body).length
    ? (redactBody(body) as Record<string, unknown>)
    : null;
}
