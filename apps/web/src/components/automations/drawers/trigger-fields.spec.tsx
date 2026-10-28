import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describeSchedule } from '@saas/shared';
import { WebhookTriggerFields } from './webhook-trigger-fields';
import { ScheduleTriggerFields } from './schedule-trigger-fields';
import { NodeInspectorDrawer } from './node-inspector-drawer';

const TOKEN = 'a'.repeat(43);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WebhookTriggerFields', () => {
  const active = { status: 'ACTIVE' as const, webhookSlug: TOKEN };

  it('shows the public address with a Copy button and both examples', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WebhookTriggerFields workflow={active} config={{}} onChange={vi.fn()} />);
    const input = screen.getByTestId('webhook-url') as HTMLInputElement;
    expect(input.value).toMatch(new RegExp(`/automations/webhook/${TOKEN}$`));
    fireEvent.click(screen.getAllByText('Copy')[0]);
    expect(writeText).toHaveBeenCalledWith(input.value);
    expect(screen.getByTestId('webhook-curl')).toHaveTextContent(`curl -X POST ${input.value}`);
    expect(screen.getByTestId('webhook-form')).toHaveTextContent(`<form method="post" action="${input.value}">`);
  });

  it('hides the address from read-only users', () => {
    render(
      <WebhookTriggerFields workflow={{ status: 'ACTIVE', webhookSlug: null }} config={{}} onChange={vi.fn()} />,
    );
    const input = screen.getByTestId('webhook-url') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Hidden — ask someone who can edit this automation');
  });

  it('hints to switch the automation on when it is not active', () => {
    render(<WebhookTriggerFields workflow={{ status: 'DRAFT', webhookSlug: TOKEN }} config={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId('webhook-inactive-hint')).toHaveTextContent('Switch the automation on to start receiving');
  });

  it('asks before regenerating', () => {
    const onRegenerate = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<WebhookTriggerFields workflow={active} config={{}} onChange={vi.fn()} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByText('Regenerate'));
    expect(onRegenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Regenerate'));
    expect(confirm).toHaveBeenCalledTimes(2);
    return Promise.resolve().then(() => expect(onRegenerate).toHaveBeenCalledTimes(1));
  });

  it('writes requireSignature and shows the secret with Copy and the header note', () => {
    const onChange = vi.fn();
    const { rerender } = render(<WebhookTriggerFields workflow={active} config={{}} onChange={onChange} />);
    expect(screen.getByLabelText('Webhook address')).toBe(screen.getByTestId('webhook-url'));
    fireEvent.click(screen.getByTestId('webhook-require-signature'));
    expect(onChange).toHaveBeenCalledWith({ requireSignature: true });
    rerender(
      <WebhookTriggerFields
        workflow={active}
        config={{ requireSignature: true, signatureSecret: 'shh-secret' }}
        onChange={onChange}
      />,
    );
    expect((screen.getByTestId('webhook-secret') as HTMLInputElement).value).toBe('shh-secret');
    expect(screen.getByTestId('webhook-secret-copy')).toBeInTheDocument();
    expect(screen.getByText(/X-Kerf-Signature: sha256=/)).toBeInTheDocument();
  });

  it('regenerates the secret after confirmation by writing regenerateSignature', () => {
    const onChange = vi.fn();
    const config = { requireSignature: true, signatureSecret: 'shh-secret' };
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<WebhookTriggerFields workflow={active} config={config} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('webhook-secret-regenerate'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('webhook-secret-regenerate'));
    expect(onChange).toHaveBeenCalledWith({ ...config, regenerateSignature: true });
  });

  it('survives a rejected regenerate mutation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRegenerate = vi.fn().mockRejectedValue(new Error('nope'));
    render(<WebhookTriggerFields workflow={active} config={{}} onChange={vi.fn()} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByText('Regenerate'));
    await Promise.resolve();
    expect(onRegenerate).toHaveBeenCalled();
  });

  it('writes redirectUrl', () => {
    const onChange = vi.fn();
    render(<WebhookTriggerFields workflow={active} config={{ requireSignature: false }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('webhook-redirect-url'), { target: { value: 'https://x.test/thanks' } });
    expect(onChange).toHaveBeenCalledWith({ requireSignature: false, redirectUrl: 'https://x.test/thanks' });
  });
});

describe('ScheduleTriggerFields', () => {
  const now = () => new Date('2026-10-29T06:00:00Z');

  const stored = { frequency: 'daily' as const, time: '09:00', timezone: 'Asia/Dubai' };

  it('starts empty without a stored schedule and writes nothing on mount', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<ScheduleTriggerFields onChange={onChange} onValidityChange={onValidityChange} now={now} />);
    expect(screen.getByTestId('schedule-empty-prompt')).toHaveTextContent('Choose when this automation runs');
    expect((screen.getByTestId('schedule-frequency') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('schedule-summary')).toBeNull();
    expect(screen.queryByTestId('schedule-next-runs')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('schedule-frequency'), { target: { value: 'daily' } });
    expect(onChange).toHaveBeenCalledWith({ frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' });
    expect(screen.queryByTestId('schedule-empty-prompt')).toBeNull();
  });

  it('shows the saved schedule read-only without inputs', () => {
    render(<ScheduleTriggerFields schedule={stored} canEdit={false} onChange={vi.fn()} now={now} />);
    expect(screen.queryByTestId('schedule-frequency')).toBeNull();
    expect(screen.getByTestId('schedule-summary')).toHaveTextContent('Every day at 09:00');
    expect(screen.getByTestId('schedule-next-runs').querySelectorAll('li')).toHaveLength(3);
  });

  it('reports invalid input to the parent', () => {
    const onValidityChange = vi.fn();
    render(<ScheduleTriggerFields schedule={stored} onChange={vi.fn()} onValidityChange={onValidityChange} now={now} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByTestId('schedule-frequency'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByTestId('schedule-day-of-month'), { target: { value: '31' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it('defaults to Gulf time and shows the summary and three next runs', () => {
    const onChange = vi.fn();
    render(<ScheduleTriggerFields schedule={stored} onChange={onChange} now={now} />);
    expect((screen.getByTestId('schedule-timezone') as HTMLSelectElement).value).toBe('Asia/Dubai');
    expect(screen.getByTestId('schedule-summary')).toHaveTextContent(
      describeSchedule({ frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' }),
    );
    const runs = screen.getByTestId('schedule-next-runs').querySelectorAll('li');
    expect(runs).toHaveLength(3);
    expect(runs[0]).toHaveTextContent('09:00');
  });

  it('shows the right fields per frequency and allows several weekdays', () => {
    const onChange = vi.fn();
    render(<ScheduleTriggerFields schedule={stored} onChange={onChange} now={now} />);
    const freq = screen.getByTestId('schedule-frequency');

    fireEvent.change(freq, { target: { value: 'hourly' } });
    expect(screen.getByTestId('schedule-minute')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-time')).toBeNull();

    fireEvent.change(freq, { target: { value: 'monthly' } });
    expect(screen.getByTestId('schedule-day-of-month')).toBeInTheDocument();

    fireEvent.change(freq, { target: { value: 'weekly' } });
    fireEvent.click(screen.getByTestId('schedule-day-3'));
    fireEvent.click(screen.getByTestId('schedule-day-5'));
    expect(onChange).toHaveBeenLastCalledWith({
      frequency: 'weekly',
      time: '09:00',
      daysOfWeek: [1, 3, 5],
      timezone: 'Asia/Dubai',
    });
  });

  it('formats next runs in the chosen zone', () => {
    render(<ScheduleTriggerFields schedule={stored} onChange={vi.fn()} now={now} />);
    fireEvent.change(screen.getByTestId('schedule-timezone'), { target: { value: 'UTC' } });
    expect(screen.getByTestId('schedule-next-runs').querySelector('li')).toHaveTextContent('09:00');
    expect(screen.getByTestId('schedule-summary')).toHaveTextContent('UTC');
  });

  it('keeps a saved zone that is not in the list selectable', () => {
    render(
      <ScheduleTriggerFields
        schedule={{ frequency: 'daily', time: '08:00', timezone: 'Africa/Cairo' }}
        onChange={vi.fn()}
        now={now}
      />,
    );
    expect((screen.getByTestId('schedule-timezone') as HTMLSelectElement).value).toBe('Africa/Cairo');
  });

  it('shows the zod message and does not write invalid input', () => {
    const onChange = vi.fn();
    render(<ScheduleTriggerFields schedule={stored} onChange={onChange} now={now} />);
    fireEvent.change(screen.getByTestId('schedule-frequency'), { target: { value: 'monthly' } });
    onChange.mockClear();
    fireEvent.change(screen.getByTestId('schedule-day-of-month'), { target: { value: '31' } });
    expect(screen.getByTestId('schedule-error')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NodeInspectorDrawer trigger sections', () => {
  const base = { position: { x: 0, y: 0 } };

  it('renders the webhook editor for a webhook trigger and routes changes to onTriggerConfigChange', () => {
    const onTriggerConfigChange = vi.fn();
    render(
      <NodeInspectorDrawer
        node={{ ...base, id: 'w', type: 'webhookTrigger', data: { label: 'Hook', config: {} } }}
        workflow={{ status: 'ACTIVE', webhookSlug: TOKEN }}
        triggerConfig={{}}
        canEditTrigger
        onTriggerConfigChange={onTriggerConfigChange}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('webhook-require-signature'));
    expect(onTriggerConfigChange).toHaveBeenCalledWith({ requireSignature: true });
  });

  it('merges a schedule into the trigger config', () => {
    const onTriggerConfigChange = vi.fn();
    render(
      <NodeInspectorDrawer
        node={{ ...base, id: 's', type: 'scheduleTrigger', data: { label: 'Tick', config: {} } }}
        workflow={{ status: 'ACTIVE', webhookSlug: null }}
        triggerConfig={{}}
        canEditTrigger
        onTriggerConfigChange={onTriggerConfigChange}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Choose when this automation runs')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('schedule-frequency'), { target: { value: 'hourly' } });
    expect(onTriggerConfigChange).toHaveBeenCalledWith({
      schedule: { frequency: 'hourly', minute: 0, timezone: 'Asia/Dubai' },
    });
  });
});
