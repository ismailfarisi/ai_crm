import { describe, expect, it } from 'vitest';
import { DEFAULT_DESTINATION, safeDestination } from '@/components/auth/safe-destination';

describe('safeDestination', () => {
  it('keeps a path inside the app, with its query and hash', () => {
    expect(safeDestination('/quotes?x=1')).toBe('/quotes?x=1');
    expect(safeDestination('/quotes/42#lines')).toBe('/quotes/42#lines');
  });

  it('falls back to the dashboard when there is no destination', () => {
    expect(safeDestination(null)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination(undefined)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination('')).toBe(DEFAULT_DESTINATION);
  });

  it.each([
    ['an external URL', 'https://evil.example'],
    ['an external URL over http', 'http://evil.example/dashboard'],
    ['a protocol-relative URL', '//evil.example'],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a backslash the browser reads as a slash', '/\\evil.example'],
    ['a tab the browser strips', '/\t/evil.example'],
    ['a relative path', 'dashboard'],
  ])('refuses %s', (_label, next) => {
    expect(safeDestination(next)).toBe(DEFAULT_DESTINATION);
  });
});
