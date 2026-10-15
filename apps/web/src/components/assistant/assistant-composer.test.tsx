import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AssistantComposer } from './assistant-composer';

function setup(onSend: (content: string) => Promise<void> | void) {
  render(<AssistantComposer busy={false} pageContext={null} onSend={(content) => onSend(content)} onStop={vi.fn()} />);
  const box = screen.getByLabelText('Message the assistant') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: 'email Ada the update' } });
  return box;
}

describe('AssistantComposer', () => {
  it('clears the box once sent', async () => {
    const box = setup(() => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(box.value).toBe('');
  });

  it('restores the typed text when sending fails', async () => {
    const box = setup(() => Promise.reject(new Error('offline')));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(box.value).toBe('email Ada the update');
  });
});
