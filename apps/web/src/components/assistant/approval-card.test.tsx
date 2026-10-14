import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalCard } from './approval-card';

const pendingAction = {
  tool: { id: 'c2', name: 'channel_message.send', args: {} },
  preview: { summary: 'Send to Ada Acme (+9715…) via WHATSAPP_META:\n\nSamples ship Monday.' },
};

describe('ApprovalCard', () => {
  it('shows the full preview text', () => {
    render(<ApprovalCard pendingAction={pendingAction} onDecide={vi.fn()} />);
    expect(screen.getByText(/Samples ship Monday\./)).toBeInTheDocument();
  });

  it('approves once and disables both buttons while pending', () => {
    const onDecide = vi.fn();
    const { rerender } = render(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onDecide).toHaveBeenCalledWith(true, undefined);
    rerender(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} disabled />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });

  it('rejects with a note', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    fireEvent.change(screen.getByPlaceholderText(/why/i), { target: { value: 'wrong tone' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm reject/i }));
    expect(onDecide).toHaveBeenCalledWith(false, 'wrong tone');
  });

  it('shows Expired with a retry action', () => {
    const onRetry = vi.fn();
    render(<ApprovalCard pendingAction={pendingAction} onDecide={vi.fn()} expired onRetry={onRetry} />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
