import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasHeader } from './canvas-header';
import type { AutomationWorkflowDto } from '@saas/shared';

describe('CanvasHeader', () => {
  const sampleWorkflow: AutomationWorkflowDto = {
    id: 'wf-1',
    tenantId: 'tenant-1',
    name: 'Order Routing Flow',
    status: 'ACTIVE',
    triggerType: 'WEBHOOK',
    triggerConfig: {},
    nodes: [],
    edges: [],
    version: 1,
    createdAt: '2026-08-17T00:00:00Z',
    updatedAt: '2026-08-17T00:00:00Z',
  };

  it('renders CanvasHeader with title, status toggle, and action buttons', () => {
    const onNameChange = vi.fn();
    const onStatusToggle = vi.fn();
    const onSave = vi.fn();
    const onOpenTestRun = vi.fn();
    const onOpenPalette = vi.fn();

    render(
      <CanvasHeader
        workflow={sampleWorkflow}
        workflowName="Order Routing Flow"
        onNameChange={onNameChange}
        status="ACTIVE"
        onStatusToggle={onStatusToggle}
        isDirty={true}
        isSaving={false}
        onSave={onSave}
        onOpenTestRun={onOpenTestRun}
        onOpenPalette={onOpenPalette}
        canUndo={true}
        canRedo={false}
      />,
    );

    expect(screen.getByTestId('canvas-header')).toBeDefined();
    expect(screen.getByDisplayValue('Order Routing Flow')).toBeDefined();
    expect(screen.getByTestId('workflow-status-badge').textContent).toBe('ACTIVE');

    // Title change
    const nameInput = screen.getByTestId('workflow-name-input');
    fireEvent.change(nameInput, { target: { value: 'Updated Flow' } });
    expect(onNameChange).toHaveBeenCalledWith('Updated Flow');

    // Toggle status
    fireEvent.click(screen.getByTestId('status-toggle-btn'));
    expect(onStatusToggle).toHaveBeenCalled();

    // Open palette
    fireEvent.click(screen.getByTestId('open-palette-btn'));
    expect(onOpenPalette).toHaveBeenCalled();

    // Open test run
    fireEvent.click(screen.getByTestId('open-test-run-btn'));
    expect(onOpenTestRun).toHaveBeenCalled();

    // Save
    fireEvent.click(screen.getByTestId('save-workflow-btn'));
    expect(onSave).toHaveBeenCalled();
  });
});
