import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AssistantConversationDetailDto, AssistantMessageDto } from '@saas/shared';

let detail: Partial<AssistantConversationDetailDto>;
const mutation = { mutate: vi.fn(), isPending: false, variables: undefined };

vi.mock('@/hooks/use-assistant', () => ({
  useAssistantConversation: () => ({ data: detail, isLoading: false }),
  useSendAssistantMessage: () => mutation,
  useDecideAssistantTurn: () => mutation,
  useCancelAssistantTurn: () => mutation,
}));
vi.mock('@/hooks/use-assistant-stream', () => ({ useAssistantStream: () => ({ connected: true }) }));
vi.mock('./assistant-provider', () => ({ useAssistant: () => ({ pageContext: null }) }));

const { AssistantThread } = await import('./assistant-thread');

function row(seq: number, role: AssistantMessageDto['role'], content: string): AssistantMessageDto {
  return { seq, role, content, turnId: 't1', createdAt: new Date(0).toISOString() } as AssistantMessageDto;
}

describe('AssistantThread', () => {
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  // Chrome 155 returns a Promise from scrollIntoView. An effect that returns
  // it hands React a non-function "cleanup", which throws on the next update.
  it('keeps rendering when scrollIntoView returns a promise', () => {
    Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as typeof original;
    detail = { messages: [row(1, 'user', 'hi')], activeTurn: null };
    const { rerender } = render(<AssistantThread conversationId="c1" variant="page" />);

    detail = { messages: [row(1, 'user', 'hi'), row(2, 'assistant', 'Hello! How can I help?')], activeTurn: null };
    expect(() => rerender(<AssistantThread conversationId="c1" variant="page" />)).not.toThrow();
    expect(screen.getByText('Hello! How can I help?')).toBeInTheDocument();
  });
});
