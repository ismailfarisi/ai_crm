import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(`https://app.example.com${path}`));
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

const SIGNED_IN = { crm_access_token: 'token' };

describe('route protection', () => {
  it('lets a signed-in visitor through', () => {
    expect(proxy(request('/dashboard', SIGNED_IN)).status).toBe(200);
  });

  it('sends a signed-in visitor off the login page', () => {
    const response = proxy(request('/login', SIGNED_IN));
    expect(response.headers.get('location')).toContain('/dashboard');
  });

  it('never redirects a customer following an acceptance link', () => {
    expect(proxy(request('/q/abc123')).status).toBe(200);
  });
});

/*
 * The access token lives 15 minutes and the refresh token much longer, but the
 * refresh cookie never reaches this server, so a plain navigation used to end
 * at /login about every quarter of an hour — with no warning, and losing
 * whatever was half-written.
 */
describe('an expired access token', () => {
  it('goes to /continue to spend the refresh token, not to /login', () => {
    const response = proxy(request('/settings/team'));
    const location = response.headers.get('location') ?? '';

    expect(location).toContain('/continue');
    expect(location).toContain('next=%2Fsettings%2Fteam');
  });

  it('keeps the query string of where the person was going', () => {
    const response = proxy(request('/quotes?status=DRAFT'));
    expect(response.headers.get('location')).toContain(
      encodeURIComponent('/quotes?status=DRAFT'),
    );
  });

  it('goes to /login once the refresh has been tried and failed', () => {
    const response = proxy(request('/settings/team', { crm_refresh_try: '1' }));
    const location = response.headers.get('location') ?? '';

    expect(location).toContain('/login');
    expect(location).not.toContain('/continue');
  });

  it('clears the marker on the way to /login, so the next expiry retries', () => {
    const response = proxy(request('/settings/team', { crm_refresh_try: '1' }));
    expect(response.cookies.get('crm_refresh_try')?.value).toBe('');
  });

  it('clears the marker once a token is seen again', () => {
    const response = proxy(request('/dashboard', { ...SIGNED_IN, crm_refresh_try: '1' }));

    expect(response.status).toBe(200);
    expect(response.cookies.get('crm_refresh_try')?.value).toBe('');
  });

  it('does not bounce /continue itself, or it would loop', () => {
    expect(proxy(request('/continue?next=%2Fdashboard')).status).toBe(200);
  });
});
