import { formatDuration, parseDuration } from '../duration';

/**
 * What a step did in one run, as a sentence: "Email sent to sara@shop.ae",
 * "No, so the run stopped on this branch". Run history and Test Run show this
 * in place of the step's stored output; the output itself stays one click
 * away for whoever needs it.
 */
export interface StepRun {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
  input?: unknown;
  output?: unknown;
  error?: string;
}

const STATUS_WORDS: Record<StepRun['status'], string> = {
  SUCCESS: 'Done',
  FAILED: 'Did not work',
  SKIPPED: 'Skipped',
  WAITING: 'Waiting',
};

export function stepStatusWord(status: StepRun['status']): string {
  return STATUS_WORDS[status] ?? status;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const names = (value: unknown): string =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v).join(', ') : '';

const clip = (text: string, max = 160): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const CHANNEL_WORDS: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', slack: 'Slack' };

const RECORD_WORDS: Record<string, string> = {
  quote: 'quote',
  proof: 'artwork proof',
  invoice: 'invoice',
  contact: 'contact',
};

function waited(value: unknown): string {
  const duration = parseDuration(value);
  return duration ? formatDuration(duration) : '';
}

function recordOutcome(input: Record<string, unknown>, output: Record<string, unknown>): string {
  const entity = String(input.entity ?? '');
  const action = String(input.action ?? '');
  const what = RECORD_WORDS[entity] ?? 'record';
  if (entity === 'summary') return 'Got today’s numbers';
  if (action === 'get') {
    const number = [output.quoteNumber, output.invoiceNumber, output.number].find((v) => typeof v === 'string' && v);
    const found = number ? `Found ${what} ${number}` : `Found the ${what}`;
    const status = typeof output.status === 'string' && output.status ? `: ${output.status.toLowerCase().replace(/_/g, ' ')}` : '';
    const waiting =
      typeof output.awaitingCustomer === 'boolean'
        ? `. ${output.awaitingCustomer ? 'Still waiting on the customer' : 'The customer has already answered'}`
        : '';
    // A test starts from a made-up record; say so, and how to try a real one.
    const madeUp =
      output.sampleRecord === true
        ? `. This is a made-up ${what} for the test; put a real one’s ID in the sample data to check it for real`
        : '';
    return `${found}${status}${waiting}${madeUp}`;
  }
  if (action === 'create') return `Added the ${what}`;
  if (action === 'update') return `Changed the ${what}`;
  if (action === 'approve') return `Approved the ${what}`;
  if (action === 'reject') return `Rejected the ${what}`;
  return '';
}

/** The sentence for one step of a run; empty when there is nothing useful to say. */
export function stepOutcome(type: string | undefined, step: StepRun): string {
  if (step.status === 'FAILED') return step.error?.trim() || 'This step did not work.';
  const input = record(step.input);
  const output = record(step.output);

  if (step.status === 'WAITING') {
    return type === 'aiAgentNode' ? 'Waiting for someone to approve what the agent wants to do' : 'Waiting for someone to approve';
  }
  if (step.status === 'SKIPPED' || output.skipped === true) return 'Skipped';

  switch (type) {
    case 'crmEventTrigger':
    case 'scheduleTrigger':
    case 'webhookTrigger':
    case 'manualTrigger':
      return 'Started the run';
    case 'delayNode': {
      const time = waited(output.duration);
      if (output.skippedInTestRun === true) {
        return time ? `Skipped for this test. A real run waits ${time} here` : 'Skipped for this test';
      }
      return time ? `Waited ${time}` : 'Waited';
    }
    case 'conditionNode':
      return output.result ? 'Yes, so the run carried on' : 'No, so the run stopped on this branch';
    case 'sendEmailNode': {
      const to = names(output.sent);
      const email = to ? `Email sent to ${to}` : 'Email sent';
      // The console mailer only writes the email to the server log.
      return output.provider === 'console' ? `${email} (test mailer: nothing left the server)` : email;
    }
    case 'sendMessageNode': {
      const to = names(output.sent);
      const channel = CHANNEL_WORDS[String(output.channel)] ?? 'Message';
      return to ? `${channel} message sent to ${to}` : `${channel} message sent`;
    }
    case 'notifyStaffNode': {
      const count = typeof output.notified === 'number' ? output.notified : null;
      if (count === 0) return 'Nobody was alerted: no one in that team has access yet';
      if (count === null) return 'Alert sent';
      return `Alerted ${count} ${count === 1 ? 'person' : 'people'} in Kerf`;
    }
    case 'crmMutateNode':
      return recordOutcome(input, output);
    case 'approvalNode': {
      if (output.decision === 'APPROVED') return 'Approved';
      if (output.decision === 'REJECTED') {
        return typeof output.reason === 'string' && output.reason ? `Rejected: ${output.reason}` : 'Rejected';
      }
      if (output.decision === 'TIMEOUT') return 'Nobody answered in time';
      return '';
    }
    case 'aiPromptNode':
      return typeof output.text === 'string' && output.text.trim() ? `Wrote: ${clip(output.text.trim())}` : 'Wrote nothing';
    case 'httpRequestNode':
      return typeof output.status === 'number' ? `The other system answered (${output.status})` : 'Sent';
    default:
      return '';
  }
}
