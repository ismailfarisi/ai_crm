import { describe, expect, it } from 'vitest';
import { stepOutcome, stepStatusWord } from './step-outcome';

const done = (output: unknown, input?: unknown) => ({ status: 'SUCCESS' as const, output, input });

describe('what a step did, in words', () => {
  it('says a wait was skipped in a test and how long a real run waits', () => {
    expect(stepOutcome('delayNode', done({ delayed: false, skippedInTestRun: true, duration: '1 day' }))).toBe(
      'Skipped for this test. A real run waits 1 day here',
    );
    expect(stepOutcome('delayNode', done({ delayed: true, duration: '3 days' }))).toBe('Waited 3 days');
  });

  it('answers a condition with yes or no', () => {
    expect(stepOutcome('conditionNode', done({ result: true }))).toBe('Yes, so the run carried on');
    expect(stepOutcome('conditionNode', done({ result: false }))).toBe('No, so the run stopped on this branch');
  });

  it('names who an email or message went to', () => {
    expect(stepOutcome('sendEmailNode', done({ sent: ['sara@shop.ae'], provider: 'ses' }))).toBe(
      'Email sent to sara@shop.ae',
    );
    expect(stepOutcome('sendEmailNode', done({ sent: ['sara@shop.ae'], provider: 'console' }))).toContain(
      'nothing left the server',
    );
    expect(stepOutcome('sendMessageNode', done({ channel: 'whatsapp', audience: 'customer', sent: ['Fatima'] }))).toBe(
      'WhatsApp message sent to Fatima',
    );
  });

  it('counts who was alerted, and says when it reached nobody', () => {
    expect(stepOutcome('notifyStaffNode', done({ notified: 3 }))).toBe('Alerted 3 people in Kerf');
    expect(stepOutcome('notifyStaffNode', done({ notified: 1 }))).toBe('Alerted 1 person in Kerf');
    expect(stepOutcome('notifyStaffNode', done({ notified: 0 }))).toMatch(/Nobody was alerted/);
  });

  it('says what a look-up found', () => {
    expect(
      stepOutcome(
        'crmMutateNode',
        done({ quoteNumber: 'Q-0042', status: 'SENT', awaitingCustomer: true }, { entity: 'quote', action: 'get' }),
      ),
    ).toBe('Found quote Q-0042: sent. Still waiting on the customer');
    expect(stepOutcome('crmMutateNode', done({ summaryText: '…' }, { entity: 'summary' }))).toBe('Got today’s numbers');
  });

  it('gives the reason when a step failed, never the step type', () => {
    expect(
      stepOutcome('sendMessageNode', { status: 'FAILED', error: 'WhatsApp is not connected, so the message was not sent.' }),
    ).toBe('WhatsApp is not connected, so the message was not sent.');
    expect(stepStatusWord('FAILED')).toBe('Did not work');
    expect(stepStatusWord('SUCCESS')).toBe('Done');
  });

  it('does not let a team-approved quote read as the customer having agreed', () => {
    const text = stepOutcome('crmMutateNode', {
      status: 'SUCCESS',
      input: { entity: 'quote', action: 'get' },
      output: { quoteNumber: 'Q-0042', status: 'APPROVED', awaitingCustomer: true, sampleRecord: true },
    } as never);
    expect(text).toContain('Found quote Q-0042: approved by your team. Still waiting on the customer');
    expect(text).toContain('made-up quote');
  });
});
