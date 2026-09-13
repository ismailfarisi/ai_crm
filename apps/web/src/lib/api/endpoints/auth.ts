/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  SessionDto,
} from '@saas/shared';
import { apiFetch } from '../client';

export const authEndpoints = {
  auth: {
    login: (input: LoginInput) =>
      apiFetch<SessionDto>('/auth/login', { method: 'POST', body: input }),
    register: (input: RegisterInput) =>
      apiFetch<SessionDto>('/auth/register', { method: 'POST', body: input }),
    acceptInvite: (input: AcceptInviteInput) =>
      apiFetch<SessionDto>('/auth/accept-invite', { method: 'POST', body: input }),
    logout: () => apiFetch<{ success: true }>('/auth/logout', { method: 'POST' }),
    me: () => apiFetch<SessionDto>('/auth/me'),
    changePassword: (input: ChangePasswordInput) =>
      apiFetch<{ success: true }>('/auth/change-password', { method: 'POST', body: input }),
  },
};

export const authKeys = {
  session: ['session'] as const,};
