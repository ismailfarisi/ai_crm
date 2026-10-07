import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditableTable } from './inline-editable-table';
import React from 'react';

describe('InlineEditableTable', () => {
  const data = [{ id: '1', name: 'John Doe', status: 'lead' }];
  const columns = [
    { accessorKey: 'name', header: 'Name', isEditable: true },
    { accessorKey: 'status', header: 'Status', isEditable: true },
  ];

  it('renders table headers and data', () => {
    render(
      <InlineEditableTable
        data={data}
        columns={columns as any}
        onCellUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText('John Doe')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
  });

  it('triggers onCellUpdate when cell commits an edit', () => {
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEditableTable
        data={data}
        columns={columns as any}
        onCellUpdate={onCellUpdate}
      />,
    );
    const cell = screen.getByText('John Doe');
    fireEvent.doubleClick(cell);
    const input = screen.getByDisplayValue('John Doe');
    fireEvent.change(input, { target: { value: 'Jane Doe' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCellUpdate).toHaveBeenCalledWith('1', 'name', 'Jane Doe');
  });
});
