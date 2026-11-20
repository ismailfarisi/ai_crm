import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AutomationEdge, AutomationNode, AutomationWorkflowDto } from '@saas/shared';
import { NodeInspectorDrawer } from './node-inspector-drawer';
import { TestRunDrawer } from './test-run-drawer';
import { DataField } from './data-field';
import { availableData } from '../step-wording';

const trigger: AutomationNode = {
  id: 't',
  type: 'crmEventTrigger',
  position: { x: 0, y: 0 },
  data: { label: 'When something happens in Kerf', config: { event: 'quote.accepted' } },
};
const wait: AutomationNode = {
  id: 'wait',
  type: 'delayNode',
  position: { x: 340, y: 0 },
  data: { label: 'Wait', config: { duration: '5 minutes' } },
};
const email: AutomationNode = {
  id: 'mail',
  type: 'sendEmailNode',
  position: { x: 680, y: 0 },
  data: { label: 'Send an email', config: { to: '', subject: '', body: '' } },
};
const check: AutomationNode = {
  id: 'check',
  type: 'conditionNode',
  position: { x: 340, y: 200 },
  data: { label: 'Only continue if…', config: { condition: '' } },
};
const allNodes = [trigger, wait, email, check];
const edges: AutomationEdge[] = [
  { id: 'e1', source: 't', target: 'wait' },
  { id: 'e2', source: 'wait', target: 'mail' },
  { id: 'e3', source: 't', target: 'check' },
];

/** The inspector with the page's job done: updates are merged back into the step. */
function Inspector({ start, onUpdate }: { start: AutomationNode; onUpdate?: (data: unknown) => void }) {
  const [node, setNode] = useState(start);
  return (
    <NodeInspectorDrawer
      node={node}
      allNodes={allNodes}
      edges={edges}
      onUpdate={(_, data) => {
        onUpdate?.(data);
        setNode((n) => ({ ...n, data: { ...n.data, ...data } }));
      }}
      onClose={vi.fn()}
    />
  );
}

describe('filling in a step without typing code', () => {
  it('shows what the step is in plain words, never its internal type', () => {
    render(<Inspector start={trigger} />);
    const drawer = screen.getByTestId('node-inspector-drawer');
    expect(drawer).not.toHaveTextContent('crmEventTrigger');
    expect(drawer).toHaveTextContent('Starts it');
    expect(screen.getByTestId('crm-event-fields')).toHaveTextContent('Quote number');
  });

  it('sets a wait as an amount and a unit, saved as the text the engine reads', () => {
    const onUpdate = vi.fn();
    render(<Inspector start={wait} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByTestId('delay-duration-input-amount'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('delay-duration-input-unit'), { target: { value: 'days' } });

    expect(onUpdate).toHaveBeenLastCalledWith({ config: expect.objectContaining({ duration: '1 day' }) });
  });

  it('inserts a field from the event into the email by picking it from a list', () => {
    const onUpdate = vi.fn();
    render(<Inspector start={email} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByTestId('email-subject-input'), { target: { value: 'Quote accepted:' } });
    fireEvent.click(screen.getByTestId('email-subject-input-insert-data'));
    expect(screen.getByTestId('email-subject-input-data-list')).toHaveTextContent('From: Customer accepted a quote');
    fireEvent.click(screen.getByText('Quote number'));

    expect(screen.getByTestId('email-subject-input')).toHaveValue('Quote accepted: {{ $trigger.payload.quoteNumber }}');
    expect(screen.getByTestId('email-subject-input-preview')).toHaveTextContent('Example: Quote accepted: Q-2026-0042');
    expect(onUpdate).toHaveBeenLastCalledWith({
      config: expect.objectContaining({ subject: 'Quote accepted: {{ $trigger.payload.quoteNumber }}' }),
    });
  });

  it('still takes an expression typed by hand', () => {
    render(<Inspector start={email} />);
    fireEvent.change(screen.getByTestId('email-body-input'), {
      target: { value: 'Total: {{ $trigger.payload.totalAmount }}' },
    });
    expect(screen.getByTestId('email-body-input-preview')).toHaveTextContent('Example: Total: 18500');
  });

  it('builds a condition from a field, a comparison and a value', () => {
    const onUpdate = vi.fn();
    render(<Inspector start={check} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByTestId('condition-field-0'), { target: { value: '$trigger.payload.totalAmount' } });
    fireEvent.change(screen.getByTestId('condition-operator-0'), { target: { value: 'gt' } });
    fireEvent.change(screen.getByTestId('condition-value-0'), { target: { value: '10000' } });

    expect(onUpdate).toHaveBeenLastCalledWith({
      config: expect.objectContaining({ condition: '$trigger.payload.totalAmount > 10000' }),
    });
    expect(screen.getByTestId('condition-summary')).toHaveTextContent(
      'Takes the Yes path when Quote total is more than 10000; otherwise the No path.',
    );
  });

  it('keeps the typed expression one click away, carrying over what the rules said', () => {
    render(<Inspector start={check} />);
    fireEvent.change(screen.getByTestId('condition-field-0'), { target: { value: '$trigger.payload.totalAmount' } });
    fireEvent.change(screen.getByTestId('condition-value-0'), { target: { value: '500' } });

    fireEvent.click(screen.getByTestId('condition-write-yourself-btn'));
    expect(screen.getByTestId('condition-expression-input')).toHaveValue('$trigger.payload.totalAmount > 500');
  });

  it('opens a condition written by hand as written, without rewriting it', () => {
    const typed = { ...check, data: { ...check.data, config: { condition: "$json.status === 'ACTIVE'" } } };
    const onUpdate = vi.fn();
    render(<Inspector start={typed} onUpdate={onUpdate} />);

    expect(screen.getByTestId('condition-expression-input')).toHaveValue("$json.status === 'ACTIVE'");
    expect(screen.queryByTestId('condition-builder')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('DataField', () => {
  it('offers no list when no earlier step has data, and stays a plain field', () => {
    render(<DataField label="Subject" value="" onChange={vi.fn()} groups={[]} testId="f" />);
    expect(screen.queryByTestId('f-insert-data')).toBeNull();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
  });

  it('inserts where the cursor is', () => {
    const onChange = vi.fn();
    const groups = availableData('mail', allNodes, edges);
    render(<DataField label="Body" value="Hello  team" onChange={onChange} groups={groups} testId="f" multiline />);

    const box = screen.getByTestId('f') as HTMLTextAreaElement;
    box.setSelectionRange(6, 6);
    fireEvent.click(screen.getByTestId('f-insert-data'));
    fireEvent.click(screen.getByText('Accepted by'));

    expect(onChange).toHaveBeenCalledWith('Hello {{ $trigger.payload.acceptedByName }} team');
  });
});

describe('trying an automation out', () => {
  const workflow = { id: 'wf-1', name: 'Tell the team', triggerType: 'CRM_EVENT' } as AutomationWorkflowDto;

  it('fills in sample data for the chosen event and sends it the way a real event arrives', async () => {
    const onExecuteTest = vi.fn().mockResolvedValue(null);
    render(
      <TestRunDrawer
        workflow={workflow}
        triggerEvent="quote.accepted"
        nodes={allNodes}
        onExecuteTest={onExecuteTest}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Sample: Customer accepted a quote')).toBeInTheDocument();
    expect(screen.getByTestId('test-sample-acceptedByName')).toHaveValue('Aisha Rahman');
    fireEvent.change(screen.getByTestId('test-sample-totalAmount'), { target: { value: '25000' } });
    fireEvent.click(screen.getByTestId('execute-test-btn'));

    expect(onExecuteTest).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'quote.accepted',
        payload: expect.objectContaining({ totalAmount: 25000, acceptedByName: 'Aisha Rahman', quoteNumber: 'Q-2026-0042' }),
      }),
    );
  });

  it('uses another event’s own fields', () => {
    render(
      <TestRunDrawer workflow={workflow} triggerEvent="invoice.overdue" onExecuteTest={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('test-sample-invoiceNumber')).toBeInTheDocument();
    expect(screen.queryByTestId('test-sample-acceptedByName')).toBeNull();
  });

  it('lets the data be edited as JSON, and refuses to run broken JSON', () => {
    const onExecuteTest = vi.fn().mockResolvedValue(null);
    render(
      <TestRunDrawer workflow={workflow} triggerEvent="quote.accepted" onExecuteTest={onExecuteTest} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('toggle-test-json-btn'));
    expect((screen.getByTestId('test-payload-input') as HTMLTextAreaElement).value).toContain('"acceptedByName"');

    fireEvent.change(screen.getByTestId('test-payload-input'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByTestId('execute-test-btn'));
    expect(onExecuteTest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('valid JSON');
  });

  it('names each step in the result, not its internal id', async () => {
    const execution = {
      id: 'ex-1',
      status: 'COMPLETED',
      nodeResults: { t: { status: 'SUCCESS', durationMs: 12 }, mail: { status: 'SUCCESS', durationMs: 430 } },
    };
    render(
      <TestRunDrawer
        workflow={workflow}
        triggerEvent="quote.accepted"
        nodes={allNodes}
        onExecuteTest={vi.fn().mockResolvedValue(execution)}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('execute-test-btn'));

    expect(await screen.findByTestId('step-trace-mail')).toHaveTextContent('Send an email');
    expect(screen.getByTestId('execution-result-section')).toHaveTextContent('Finished');
  });
});
