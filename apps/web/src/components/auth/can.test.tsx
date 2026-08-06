import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Can } from '@/components/auth/can';
import { useSession } from '@/lib/session-context';
import type { Permission } from '@saas/shared';

vi.mock('@/lib/session-context', () => ({
  useSession: vi.fn(),
}));

const useSessionMock = vi.mocked(useSession);

function mockSession(permissions: Permission[]) {
  useSessionMock.mockReturnValue({
    check: (rule: {
      permission?: Permission | Permission[];
      anyOf?: Permission[];
      role?: string[];
    }) => {
      const held = (p: Permission) => permissions.includes(p);
      if (rule.permission) {
        const list = Array.isArray(rule.permission) ? rule.permission : [rule.permission];
        return list.every(held);
      }
      if (rule.anyOf) return rule.anyOf.some(held);
      return false;
    },
  } as never);
}

describe('Can', () => {
  it('renders children when the permission is held', () => {
    mockSession(['contact:create' as Permission]);
    render(
      <Can permission={'contact:create' as Permission}>
        <button>New contact</button>
      </Can>,
    );
    expect(screen.getByRole('button', { name: 'New contact' })).toBeInTheDocument();
  });

  it('renders the fallback when denied', () => {
    mockSession(['contact:read' as Permission]);
    render(
      <Can permission={'contact:create' as Permission} fallback={<span>No access</span>}>
        <button>New contact</button>
      </Can>,
    );
    expect(screen.queryByRole('button', { name: 'New contact' })).not.toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('renders nothing when denied without a fallback', () => {
    mockSession([]);
    render(
      <Can permission={'contact:create' as Permission}>
        <button>New contact</button>
      </Can>,
    );
    expect(screen.queryByRole('button', { name: 'New contact' })).not.toBeInTheDocument();
  });

  it('passes the allowed flag to a function child', () => {
    mockSession(['contact:delete' as Permission]);
    render(
      <Can permission={'contact:delete' as Permission}>
        {(allowed) => <button disabled={!allowed}>Delete</button>}
      </Can>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
  });
});
