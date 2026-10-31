import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RegisterForm } from '@/components/auth/register-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api/endpoints', () => ({
  api: { auth: { register: vi.fn() } },
}));

describe('RegisterForm', () => {
  it('defaults the base currency to the dirham and lists it first', () => {
    render(<RegisterForm />);
    const select = screen.getByLabelText('Base currency') as HTMLSelectElement;
    expect(select.value).toBe('AED');
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(options[0].value).toBe('AED');
    // Still offers the rest, once each.
    expect(options.filter((option) => option.value === 'AED')).toHaveLength(1);
    expect(options.map((option) => option.value)).toContain('USD');
  });

  it('links to sign-in in ink, not amber', () => {
    render(<RegisterForm />);
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveClass('text-ink', 'underline');
    expect(link).not.toHaveClass('text-brand');
  });
});
