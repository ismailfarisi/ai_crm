import { of, throwError, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditService } from './audit.service';

const user = {
  id: 'u1',
  organizationId: 'org1',
  email: 'kim@northwind.test',
  firstName: 'Kim',
  lastName: 'Reyes',
  permissions: [],
} as never;

function contextFor(
  method: string,
  path: string,
  extra: Record<string, unknown> = {},
): ExecutionContext {
  const req = {
    method,
    path,
    params: {},
    body: {},
    ip: '10.0.0.1',
    user,
    ...extra,
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

const QUOTE_ID = '7f1c2a3b-4d5e-6f70-8a9b-0c1d2e3f4a5b';

describe('AuditInterceptor', () => {
  let audit: { record: jest.Mock; snapshot: jest.Mock };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
    };
    interceptor = new AuditInterceptor(audit as unknown as AuditService);
  });

  const run = async (
    context: ExecutionContext,
    handler: CallHandler = handlerReturning({ id: QUOTE_ID }),
  ) => {
    const result = await interceptor.intercept(context, handler);
    await lastValueFrom(result).catch(() => undefined);
    // The row is written without the request waiting for it.
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('ignores reads', async () => {
    await run(contextFor('GET', '/api/v1/quotes'));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('names the action after the route and records the actor', async () => {
    await run(contextFor('POST', '/api/v1/quotes'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.create',
        subjectType: 'QUOTE',
        subjectId: QUOTE_ID,
        actorId: 'u1',
        actorName: 'Kim Reyes',
        ip: '10.0.0.1',
        origin: 'HUMAN',
        channel: 'WEB',
      }),
    );
  });

  it('photographs the record either side of an update', async () => {
    const id = QUOTE_ID;
    audit.snapshot
      .mockResolvedValueOnce({ status: 'DRAFT' })
      .mockResolvedValueOnce({ status: 'APPROVED' });
    await run(
      contextFor('PATCH', `/api/v1/quotes/${id}`, { params: { id } }),
      handlerReturning({ id }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.update',
        subjectId: id,
        before: { status: 'DRAFT' },
        after: { status: 'APPROVED' },
      }),
    );
  });

  it('records a sub-action by its own name', async () => {
    const id = QUOTE_ID;
    await run(
      contextFor('POST', `/api/v1/quotes/${id}/signal`, { params: { id } }),
      handlerReturning({ id }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.signal' }),
    );
  });

  it('writes nothing when the request failed', async () => {
    await run(contextFor('POST', '/api/v1/quotes'), {
      handle: () => throwError(() => new Error('rejected')),
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never keeps a body from a credential route', async () => {
    await run(
      contextFor('POST', '/api/v1/auth/change-password', {
        body: { currentPassword: 'a', newPassword: 'b' },
      }),
      handlerReturning(undefined),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.change_password', after: null }),
    );
  });

  it('leaves the audit trail itself out of the audit trail', async () => {
    await run(contextFor('POST', '/api/v1/notifications/read-all'));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ignores a write from an unauthenticated caller', async () => {
    await run(contextFor('POST', '/api/v1/quotes', { user: undefined }));
    expect(audit.record).not.toHaveBeenCalled();
  });
});
