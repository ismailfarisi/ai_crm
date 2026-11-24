import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NextStep } from '@/lib/next-step';
import { NextStepCard } from './next-step-card';

const step: NextStep<{ kind: 'payment' }> = {
  title: 'Wait for payment',
  detail: 'AED 100.00 is still owed. Record the payment when it arrives.',
  action: { kind: 'payment' },
  whoCan: 'Ask someone who can manage invoices to record it.',
  trail: [],
};

describe('NextStepCard', () => {
  it('says who to ask, with no button, when this user cannot take the step', () => {
    render(<NextStepCard step={step} action={null} />);
    expect(screen.getByText('Ask someone who can manage invoices to record it.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the button and not the hint when the user can take the step', () => {
    render(<NextStepCard step={step} action={<button>Record payment</button>} />);
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeTruthy();
    expect(screen.queryByText(/Ask someone/)).toBeNull();
  });

  it('trusts `allowed` when the button lives elsewhere on the page', () => {
    const { rerender } = render(<NextStepCard step={step} allowed />);
    expect(screen.queryByText(/Ask someone/)).toBeNull();
    rerender(<NextStepCard step={step} allowed={false} />);
    expect(screen.getByText(/Ask someone/)).toBeTruthy();
  });

  it('says nothing about who to ask when there is no step to take', () => {
    render(<NextStepCard step={{ ...step, action: undefined, finished: true }} />);
    expect(screen.queryByText(/Ask someone/)).toBeNull();
  });
});
