import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataViewContainer } from './data-view-container';
import React from 'react';

vi.mock('@/hooks/use-saved-views', () => ({
  useSavedViews: () => ({
    views: [{ id: '1', name: 'All', viewType: 'table', isDefault: true }],
    activeView: { id: '1', name: 'All', viewType: 'table', isDefault: true },
    setActiveViewId: vi.fn(),
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi.fn(),
  }),
}));

describe('DataViewContainer', () => {
  it('renders top toolbar with view switcher and search', () => {
    render(
      <DataViewContainer
        entityType="quotes"
        search=""
        onSearchChange={vi.fn()}
      >
        {() => <div>Content Body</div>}
      </DataViewContainer>,
    );
    expect(screen.getByText('Content Body')).toBeDefined();
    expect(screen.getByPlaceholderText('Search...')).toBeDefined();
  });
});
