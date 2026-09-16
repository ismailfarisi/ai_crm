import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cookieStore, headerStore } = vi.hoisted(() => ({
  cookieStore: { getAll: vi.fn(() => [{ name: 'crm_access_token', value: 'tok' }]) },
  headerStore: { get: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
  headers: () => Promise.resolve(headerStore),
}));

import { serverFetch } from './server';

describe('serverFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    headerStore.get.mockReset();
  });

  const sentHeaders = () =>
    (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

  it('forwards the session cookie', async () => {
    await serverFetch('/auth/me');
    expect(sentHeaders().cookie).toBe('crm_access_token=tok');
  });

  /**
   * Without this every server-rendered request reaches the API from one
   * container, so the whole deployment shares a single rate-limit bucket and
   * the audit trail records the container instead of the person.
   */
  it('forwards the caller’s address, unchanged', async () => {
    headerStore.get.mockImplementation((name: string) =>
      ({
        'x-forwarded-for': '203.0.113.10, 172.69.224.98',
        'cf-connecting-ip': '203.0.113.10',
      })[name] ?? null,
    );
    await serverFetch('/auth/me');
    const headers = sentHeaders();
    // Verbatim: the API counts hops from the right, so adding our own would
    // shift which entry it trusts.
    expect(headers['x-forwarded-for']).toBe('203.0.113.10, 172.69.224.98');
    expect(headers['cf-connecting-ip']).toBe('203.0.113.10');
  });

  it('sends no forwarding headers when the request carried none', async () => {
    headerStore.get.mockReturnValue(null);
    await serverFetch('/auth/me');
    expect(Object.keys(sentHeaders())).toEqual(['cookie']);
  });

  it('lets an explicit header win over a forwarded one', async () => {
    headerStore.get.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '203.0.113.10' : null,
    );
    await serverFetch('/auth/me', { headers: { 'x-forwarded-for': '198.51.100.1' } });
    expect(sentHeaders()['x-forwarded-for']).toBe('198.51.100.1');
  });
});
