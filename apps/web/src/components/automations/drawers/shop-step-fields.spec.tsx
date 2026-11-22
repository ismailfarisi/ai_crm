import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AUTOMATION_NOTIFY_GROUPS } from '@saas/shared';
import type { AutomationNode } from '@saas/shared';
import { NodeInspectorDrawer } from './node-inspector-drawer';
import { MessageStepFields, NotifyStepFields } from './shop-step-fields';
import { CrmStepFields } from './crm-step-fields';
import { NODE_PALETTE_ITEMS } from './node-palette-drawer';
import { stepWording } from '../step-wording';
import { DEFAULT_NODE_CONFIGS, DEFAULT_NODE_LABELS } from '@/hooks/use-automation-canvas';

const optionTexts = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.text);

const mk = (type: string, config: Record<string, unknown>): AutomationNode =>
  ({ id: 'n1', type, position: { x: 0, y: 0 }, data: { label: 'Step', config } }) as AutomationNode;

describe('Send Message step', () => {
  it('offers the three chat channels and both audiences', () => {
    render(<MessageStepFields config={DEFAULT_NODE_CONFIGS.sendMessageNode} onChange={vi.fn()} />);
    expect(optionTexts(screen.getByTestId('message-channel-select'))).toEqual(['WhatsApp', 'Telegram', 'Slack']);
    expect(optionTexts(screen.getByTestId('message-audience-select'))).toEqual(['A colleague', 'A customer']);
  });

  it('says what a customer message needs before it can go out', () => {
    render(
      <MessageStepFields
        config={{ channel: 'WHATSAPP_META', audience: 'customer', to: '', body: '' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/already messaged you on WhatsApp/)).toBeTruthy();
    expect(screen.getByText(/not by an AI step/)).toBeTruthy();
  });

  it('writes each field into the step config', () => {
    const onChange = vi.fn();
    const config = { channel: 'WHATSAPP_META', audience: 'staff', to: '', body: '' };
    render(<MessageStepFields config={config} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('message-channel-select'), { target: { value: 'SLACK' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, channel: 'SLACK' });
    fireEvent.change(screen.getByTestId('message-to-input'), { target: { value: 'floor@shop.ae' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, to: 'floor@shop.ae' });
    fireEvent.change(screen.getByTestId('message-body-input'), { target: { value: 'Start the job' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, body: 'Start the job' });
  });

  it('shows in the step inspector', () => {
    render(
      <NodeInspectorDrawer
        node={mk('sendMessageNode', DEFAULT_NODE_CONFIGS.sendMessageNode)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('message-channel-select')).toBeTruthy();
  });
});

describe('Notify Staff step', () => {
  it('offers every team, by the work its people do', () => {
    render(<NotifyStepFields config={DEFAULT_NODE_CONFIGS.notifyStaffNode} onChange={vi.fn()} />);
    expect(optionTexts(screen.getByTestId('notify-group-select'))).toEqual([
      'Choose…',
      ...AUTOMATION_NOTIFY_GROUPS.map((group) => group.label),
    ]);
    expect(screen.queryByTestId('notify-to-input')).toBeNull();
  });

  it('asks for an email instead when notifying named people', () => {
    const onChange = vi.fn();
    const config = { audience: 'person', to: '', title: '' };
    render(<NotifyStepFields config={config} onChange={onChange} />);
    expect(screen.queryByTestId('notify-group-select')).toBeNull();
    fireEvent.change(screen.getByTestId('notify-to-input'), { target: { value: 'buyer@shop.ae' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, to: 'buyer@shop.ae' });
  });

  it('shows in the step inspector', () => {
    const onUpdate = vi.fn();
    render(
      <NodeInspectorDrawer
        node={mk('notifyStaffNode', DEFAULT_NODE_CONFIGS.notifyStaffNode)}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('notify-title-input'), { target: { value: 'Board is low' } });
    expect(onUpdate).toHaveBeenLastCalledWith('n1', {
      config: { ...DEFAULT_NODE_CONFIGS.notifyStaffNode, title: 'Board is low' },
    });
  });
});

describe('Kerf Record step', () => {
  it('offers the lookups and asks for the record to look up', () => {
    const { rerender } = render(<CrmStepFields config={{ entity: 'proof', action: 'get' }} onChange={vi.fn()} />);
    expect(optionTexts(screen.getByTestId('crm-action-select'))).toEqual(['Choose…', 'Look up (changes nothing)']);
    expect(screen.getByTestId('crm-record-id-input')).toBeTruthy();
    rerender(<CrmStepFields config={{ entity: 'summary', action: 'daily' }} onChange={vi.fn()} />);
    expect(screen.queryByTestId('crm-record-id-input')).toBeNull();
  });
});

describe('palette', () => {
  it('lists the new steps and describes the Kerf Record step by what it does', () => {
    const byType = Object.fromEntries(NODE_PALETTE_ITEMS.map((item) => [item.type, item]));
    expect(byType.sendMessageNode).toBeDefined();
    expect(byType.notifyStaffNode).toBeDefined();
    // The step chooser shows the plain wording, which is also a new step's name.
    expect(DEFAULT_NODE_LABELS.sendMessageNode).toBe('Send a message');
    expect(DEFAULT_NODE_LABELS.notifyStaffNode).toBe('Alert the team in Kerf');
    const record = stepWording('crmMutateNode')!.description;
    expect(record).not.toMatch(/deal|task/i);
    expect(record).toMatch(/contact/);
    expect(record).toMatch(/look up/i);
  });
});
