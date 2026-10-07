import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from './kanban-board';
import React from 'react';

describe('KanbanBoard', () => {
  const columns = [
    { key: 'draft', label: 'Draft', color: 'slate' },
    { key: 'approved', label: 'Approved', color: 'emerald' },
  ];
  const items = [{ id: 'item-1', title: 'Quote 1', status: 'draft' }];

  it('renders columns and items', () => {
    render(
      <KanbanBoard
        columns={columns}
        items={items}
        getStageKey={(i) => i.status}
        getItemId={(i) => i.id}
        renderCard={(i) => <div>{i.title}</div>}
        onMoveStage={vi.fn()}
      />,
    );
    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText('Approved')).toBeDefined();
    expect(screen.getByText('Quote 1')).toBeDefined();
  });

  it('triggers onMoveStage on drop', () => {
    const onMoveStage = vi.fn().mockResolvedValue(undefined);
    render(
      <KanbanBoard
        columns={columns}
        items={items}
        getStageKey={(i) => i.status}
        getItemId={(i) => i.id}
        renderCard={(i) => <div>{i.title}</div>}
        onMoveStage={onMoveStage}
      />,
    );

    const approvedCol = screen.getByLabelText('Approved column');
    fireEvent.drop(approvedCol, {
      dataTransfer: {
        getData: () => 'item-1',
      },
    });

    expect(onMoveStage).toHaveBeenCalledWith('item-1', 'approved');
  });
});
