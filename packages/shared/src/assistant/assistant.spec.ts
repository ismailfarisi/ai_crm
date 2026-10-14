import { describe, it, expect } from 'vitest';
import {
  ACTIVE_ASSISTANT_TURN_STATUSES,
  assistantApprovalSchema,
  sendAssistantMessageSchema,
  updateAssistantConversationSchema,
} from './index';
import { PERMISSIONS } from '../rbac/permissions';
import { AUDIT_CHANNELS } from '../platform/audit';
import { CHANNEL_SKILLS } from '../channels/skills';

describe('assistant contract', () => {
  it('trims content and accepts a page context', () => {
    const parsed = sendAssistantMessageSchema.parse({
      content: '  show me Acme  ',
      context: { entity: 'quote', id: 'q-1', label: 'Q-1042' },
    });
    expect(parsed.content).toBe('show me Acme');
    expect(parsed.context?.label).toBe('Q-1042');
  });

  it('rejects empty and oversized content', () => {
    expect(sendAssistantMessageSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(sendAssistantMessageSchema.safeParse({ content: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('accepts a null context (re-submitting a loaded conversation)', () => {
    expect(sendAssistantMessageSchema.safeParse({ content: 'hi', context: null }).success).toBe(true);
  });

  it('requires something to update', () => {
    expect(updateAssistantConversationSchema.safeParse({}).success).toBe(false);
    expect(updateAssistantConversationSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it('caps the approval note', () => {
    expect(assistantApprovalSchema.safeParse({ approved: false, note: 'n'.repeat(501) }).success).toBe(false);
  });

  it('exposes the active statuses, permission, audit channel and skill names', () => {
    expect(ACTIVE_ASSISTANT_TURN_STATUSES).toEqual(['RUNNING', 'AWAITING_APPROVAL']);
    expect(PERMISSIONS.ASSISTANT_USE).toBe('assistant:use');
    expect(AUDIT_CHANNELS).toContain('ASSISTANT');
    expect(CHANNEL_SKILLS.CHANNEL_THREAD_READ).toBe('channel_thread.read');
    expect(CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND).toBe('channel_message.send');
  });
});
