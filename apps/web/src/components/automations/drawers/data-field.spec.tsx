import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataField } from './data-field';
import { codeText, friendlyText, type DataGroup } from '../step-wording';

const groups: DataGroup[] = [
  {
    id: 'trigger-1',
    title: 'From: Customer accepted a quote',
    items: [
      { label: 'Quote number', expression: '$trigger.payload.quoteNumber', type: 'text', sample: 'Q-2026-0042' },
      { label: 'Total', expression: '$trigger.payload.total', type: 'number', sample: 18500 },
    ],
  },
  {
    id: 'lookup-1',
    title: 'From: Look up the invoice',
    items: [{ label: 'Total', expression: '$node["lookup-1"].total', alias: '$json.total', type: 'number' }],
  },
];

function Field({ start, onStored }: { start: string; onStored?: (value: string) => void }) {
  const [value, setValue] = useState(start);
  return (
    <DataField
      label="Message"
      testId="field"
      groups={groups}
      value={value}
      onChange={(v) => {
        setValue(v);
        onStored?.(v);
      }}
    />
  );
}

describe('data shown as named chips', () => {
  it('shows saved code as a chip with its plain name and never as code', () => {
    render(<Field start="Thanks for {{ $trigger.payload.quoteNumber }}!" />);

    expect(screen.getByTestId('field')).toHaveValue('Thanks for {{Quote number}}!');
    expect(screen.getByTestId('field-chip')).toHaveTextContent('Quote number');
    expect(screen.getByTestId('field-shown').textContent).not.toContain('$trigger');
  });

  it('stores the code the run needs, whatever the box shows', () => {
    const onStored = vi.fn();
    render(<Field start="" onStored={onStored} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'Ref {{Quote number}} is ready' } });

    expect(onStored).toHaveBeenLastCalledWith('Ref {{ $trigger.payload.quoteNumber }} is ready');
  });

  it('turns code typed by hand into its chip', () => {
    render(<Field start="" />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'Ref {{ $trigger.payload.quoteNumber }}' } });

    expect(screen.getByTestId('field')).toHaveValue('Ref {{Quote number}}');
  });

  it('Backspace after a chip removes the whole chip', () => {
    const onStored = vi.fn();
    render(<Field start="Ref {{ $trigger.payload.quoteNumber }} ok" onStored={onStored} />);
    const box = screen.getByTestId('field') as HTMLTextAreaElement;
    const end = 'Ref {{Quote number}}'.length;
    box.setSelectionRange(end, end);

    fireEvent.keyDown(box, { key: 'Backspace' });

    expect(onStored).toHaveBeenLastCalledWith('Ref  ok');
    expect(screen.queryByTestId('field-chip')).toBeNull();
  });

  it('Delete before a chip removes the whole chip', () => {
    const onStored = vi.fn();
    render(<Field start="Ref {{ $trigger.payload.quoteNumber }} ok" onStored={onStored} />);
    const box = screen.getByTestId('field') as HTMLTextAreaElement;
    box.setSelectionRange(4, 4);

    fireEvent.keyDown(box, { key: 'Delete' });

    expect(onStored).toHaveBeenLastCalledWith('Ref  ok');
  });

  it('leaves text it does not recognise exactly as typed', () => {
    const onStored = vi.fn();
    render(<Field start="{{ $json.custom.deep }} and {{ nonsense" onStored={onStored} />);

    expect(screen.getByTestId('field')).toHaveValue('{{ $json.custom.deep }} and {{ nonsense');
    fireEvent.change(screen.getByTestId('field'), { target: { value: '{{ $json.custom.deep }} and {{ nonsense!' } });
    expect(onStored).toHaveBeenLastCalledWith('{{ $json.custom.deep }} and {{ nonsense!');
  });

  it('tells apart two values with the same name by the step they come from', () => {
    const stored = 'A {{ $trigger.payload.total }} B {{ $json.total }}';
    const shown = friendlyText(stored, groups);

    expect(shown).toBe('A {{Total from From: Customer accepted a quote}} B {{Total from From: Look up the invoice}}');
    expect(codeText(shown, groups)).toBe('A {{ $trigger.payload.total }} B {{ $node["lookup-1"].total }}');
  });

  it('keeps a one-line field to one line', () => {
    const onStored = vi.fn();
    render(<Field start="" onStored={onStored} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'a\nb' } });

    expect(onStored).toHaveBeenLastCalledWith('a b');
  });
});
