import {
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

const TOKEN = 'Ab_-'.repeat(10) + 'xyz'; // 43 chars

function hostFor(method: string, url: string) {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method, url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => error.mockRestore());

  it('answers an unexpected error with a generic 500 and logs the route', () => {
    const { host, response } = hostFor('GET', '/api/v1/quotes/1');
    new AllExceptionsFilter().catch(new Error('boom'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(error.mock.calls[0][0]).toBe('GET /api/v1/quotes/1 → 500');
  });

  it('never logs a webhook token: the segment after /automations/webhook/ is masked', () => {
    const { host } = hostFor(
      'POST',
      `/api/v1/automations/webhook/${TOKEN}?x=1`,
    );
    new AllExceptionsFilter().catch(new Error('boom'), host);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(error.mock.calls[0][0]).toBe(
      'POST /api/v1/automations/webhook/***?x=1 → 500',
    );
  });

  it('does not log 4xx errors', () => {
    const { host, response } = hostFor('GET', '/api/v1/quotes/1');
    new AllExceptionsFilter().catch(new NotFoundException(), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the extra fields a 4xx was thrown with, e.g. who decided an approval first', () => {
    const { host, response } = hostFor(
      'POST',
      '/api/v1/automation-approvals/a/decision',
    );
    new AllExceptionsFilter().catch(
      new ConflictException({
        message: 'Already decided',
        status: 'APPROVED',
        decidedBy: { id: 'u1', name: 'Ana Silva' },
        decidedAt: '2026-10-29T10:00:00.000Z',
      }),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'Already decided',
      error: 'ConflictException',
      status: 'APPROVED',
      decidedBy: { id: 'u1', name: 'Ana Silva' },
      decidedAt: '2026-10-29T10:00:00.000Z',
    });
  });

  it('never passes extra fields through on a 5xx', () => {
    const { host, response } = hostFor('GET', '/api/v1/x');
    new AllExceptionsFilter().catch(
      new ServiceUnavailableException({ message: 'Down', internal: 'secret' }),
      host,
    );
    expect(response.json.mock.calls[0][0]).not.toHaveProperty('internal');
  });
});
