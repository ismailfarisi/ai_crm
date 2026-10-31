import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginForm } from '@/components/auth/login-form';
import { api } from '@/lib/api/endpoints';

let query = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));

vi.mock('@/lib/api/endpoints', () => ({
  api: { auth: { login: vi.fn() } },
}));

const login = vi.mocked(api.auth.login);
const realLocation = window.location;

beforeEach(() => {
  // jsdom cannot navigate; a plain object records where the form sent us.
  const location = { href: '', assign: (url: string) => void (location.href = url) };
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  login.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

async function signIn() {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(login).toHaveBeenCalled());
}

describe('LoginForm', () => {
  it('goes on to an in-app `next` after signing in', async () => {
    login.mockResolvedValue(undefined as never);
    query = `next=${encodeURIComponent('/quotes?x=1')}`;
    await signIn();
    await waitFor(() => expect(window.location.href).toBe('/quotes?x=1'));
  });

  it.each([
    ['an external URL', 'https://evil.example'],
    ['a protocol-relative URL', '//evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('ignores %s in `next` and opens the dashboard', async (_label, next) => {
    login.mockResolvedValue(undefined as never);
    query = `next=${encodeURIComponent(next)}`;
    await signIn();
    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
  });

  it('says what to do when Kerf cannot be reached', async () => {
    login.mockRejectedValue(new TypeError('Failed to fetch'));
    query = '';
    await signIn();
    expect(
      await screen.findByText(
        "Kerf can't be reached right now. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('links to registration in ink, not amber', () => {
    render(<LoginForm />);
    const link = screen.getByRole('link', { name: 'Create one' });
    expect(link).toHaveClass('text-ink', 'underline');
    expect(link).not.toHaveClass('text-brand');
  });
});
