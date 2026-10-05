import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkOrderDto } from '@saas/shared';
import { ProductionBoard } from './production-board';
import { useWorkOrders, useWorkOrder, useWorkOrderAction } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';

vi.mock('@/hooks/use-work-orders', () => ({
  useWorkOrders: vi.fn(),
  useWorkOrder: vi.fn(),
  useWorkOrderAction: vi.fn(),
}));

vi.mock('@/lib/session-context', () => ({
  useCan: vi.fn(),
}));

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    workOrders: {
      list: vi.fn(),
      get: vi.fn(),
      release: vi.fn().mockImplementation(async (id: string) => ({
        id,
        woNumber: 'WO-1001',
        status: 'RELEASED',
        operations: [
          {
            id: 'op-1',
            sequence: 1,
            label: 'Printing',
            workCenterId: 'wc-1',
            workCenterName: 'Offset Press',
            status: 'PENDING',
            estimatedSetupMinutes: 30,
            estimatedRunMinutes: 60,
            estimatedChargedMinutes: 90,
            actualMinutes: 0,
            runningSince: null,
            operatorId: null,
            startedAt: null,
            completedAt: null,
          },
        ],
      })),
      complete: vi.fn().mockResolvedValue({ id: 'wo-2', woNumber: 'WO-1002', status: 'COMPLETE' }),
      start: vi.fn().mockResolvedValue({ id: 'wo-3', woNumber: 'WO-1003', status: 'IN_PROGRESS' }),
      stop: vi.fn().mockResolvedValue({ workOrder: { id: 'wo-2' }, capped: false }),
      finish: vi.fn().mockResolvedValue({ workOrder: { id: 'wo-2' }, capped: false }),
      logTime: vi.fn().mockResolvedValue({ id: 'wo-2' }),
    },
  },
  queryKeys: {
    workOrders: vi.fn(() => ['work-orders']),
    workOrder: vi.fn((id: string) => ['work-orders', id]),
  },
}));

const mockWorkOrders: WorkOrderDto[] = [
  {
    id: 'wo-1',
    woNumber: 'WO-1001',
    status: 'PLANNED',
    salesOrderId: 'so-1',
    salesOrderNumber: 'SO-5001',
    salesOrderLineId: 'line-1',
    customerName: 'Acme Corp',
    description: 'Custom Folding Carton',
    templateId: 'tmpl-1',
    templateName: 'Carton',
    templateVersion: 1,
    qty: 1000,
    qtyCompleted: null,
    dueDate: '2026-12-31T00:00:00.000Z',
    releasedAt: null,
    completedAt: null,
    quotedUnitCost: 1.5,
    estimatedCost: null,
    actualCost: null,
    operations: [
      {
        id: 'op-1',
        sequence: 1,
        label: 'Printing',
        workCenterId: 'wc-1',
        workCenterName: 'Offset Press',
        status: 'PENDING',
        estimatedSetupMinutes: 30,
        estimatedRunMinutes: 60,
        estimatedChargedMinutes: 90,
        actualMinutes: 0,
        runningSince: null,
        operatorId: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    materials: [
      {
        id: 'mat-1',
        materialId: 'm-1',
        materialName: 'SBS Paperboard',
        uom: 'SHEET',
        qtyPlanned: 1000,
        qtyIssued: 500,
        qtyReturned: 0,
        valueIssued: 250,
        estimatedUnitCost: 0.25,
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'wo-2',
    woNumber: 'WO-1002',
    status: 'RELEASED',
    salesOrderId: 'so-2',
    salesOrderNumber: 'SO-5002',
    salesOrderLineId: 'line-2',
    customerName: 'Beta Industries',
    description: 'Corrugated Shipping Box',
    templateId: null,
    templateName: null,
    templateVersion: null,
    qty: 500,
    qtyCompleted: null,
    dueDate: '2026-01-01T00:00:00.000Z', // Past due (overdue)
    releasedAt: '2026-01-02T00:00:00.000Z',
    completedAt: null,
    quotedUnitCost: 2.0,
    estimatedCost: null,
    actualCost: null,
    operations: [
      {
        id: 'op-2',
        sequence: 1,
        label: 'Die Cutting',
        workCenterId: 'wc-2',
        workCenterName: 'Flatbed Cutter',
        status: 'RUNNING',
        estimatedSetupMinutes: 15,
        estimatedRunMinutes: 45,
        estimatedChargedMinutes: 60,
        actualMinutes: 30,
        runningSince: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        operatorId: 'user-1',
        startedAt: '2026-01-02T10:00:00.000Z',
        completedAt: null,
      },
    ],
    materials: [],
    createdAt: '2026-09-02T00:00:00.000Z',
  },
  {
    id: 'wo-3',
    woNumber: 'WO-1003',
    status: 'IN_PROGRESS',
    salesOrderId: 'so-3',
    salesOrderNumber: 'SO-5003',
    salesOrderLineId: 'line-3',
    customerName: 'Gamma Logistics',
    description: 'Heavy Duty Crate',
    templateId: null,
    templateName: null,
    templateVersion: null,
    qty: 200,
    qtyCompleted: null,
    dueDate: '2026-12-15T00:00:00.000Z',
    releasedAt: '2026-09-10T00:00:00.000Z',
    completedAt: null,
    quotedUnitCost: 5.0,
    estimatedCost: null,
    actualCost: null,
    operations: [
      {
        id: 'op-3',
        sequence: 1,
        label: 'Assembly',
        workCenterId: 'wc-3',
        workCenterName: 'Bench Assembly',
        status: 'PENDING',
        estimatedSetupMinutes: 20,
        estimatedRunMinutes: 40,
        estimatedChargedMinutes: 60,
        actualMinutes: 10,
        runningSince: null,
        operatorId: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    materials: [],
    createdAt: '2026-09-03T00:00:00.000Z',
  },
  {
    id: 'wo-4',
    woNumber: 'WO-1004',
    status: 'COMPLETE',
    salesOrderId: 'so-4',
    salesOrderNumber: 'SO-5004',
    salesOrderLineId: 'line-4',
    customerName: 'Delta Retail',
    description: 'Display Stand',
    templateId: null,
    templateName: null,
    templateVersion: null,
    qty: 50,
    qtyCompleted: 50,
    dueDate: '2026-01-01T00:00:00.000Z', // In past, but COMPLETE so not overdue
    releasedAt: '2026-01-02T00:00:00.000Z',
    completedAt: '2026-01-03T00:00:00.000Z',
    quotedUnitCost: 10.0,
    estimatedCost: null,
    actualCost: null,
    operations: [
      {
        id: 'op-4',
        sequence: 1,
        label: 'Finishing',
        workCenterId: 'wc-1',
        workCenterName: 'Offset Press',
        status: 'DONE',
        estimatedSetupMinutes: 10,
        estimatedRunMinutes: 20,
        estimatedChargedMinutes: 30,
        actualMinutes: 30,
        runningSince: null,
        operatorId: null,
        startedAt: '2026-01-02T00:00:00.000Z',
        completedAt: '2026-01-03T00:00:00.000Z',
      },
    ],
    materials: [],
    createdAt: '2026-09-04T00:00:00.000Z',
  },
];

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionBoard />
    </QueryClientProvider>,
  );
}

describe('ProductionBoard', () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
    vi.mocked(useWorkOrders).mockReturnValue({
      data: mockWorkOrders,
      isPending: false,
      isError: false,
      error: null,
    } as never);
    vi.mocked(useWorkOrder).mockImplementation((id: string | null) => {
      const match = mockWorkOrders.find((w) => w.id === id);
      return {
        data: match ?? null,
        isPending: false,
        isError: false,
        error: null,
      } as never;
    });
    vi.mocked(useWorkOrderAction).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as never);
  });

  describe('KPI Summary Calculations', () => {
    it('calculates active jobs, running clocks, and overdue jobs accurately', () => {
      renderBoard();

      // Active jobs = RELEASED (wo-2) + IN_PROGRESS (wo-3) = 2
      const activeCard = screen.getByTestId('kpi-active-jobs');
      expect(within(activeCard).getByText('2')).toBeInTheDocument();

      // Running clocks = wo-2 has op-2 with status RUNNING = 1
      const runningCard = screen.getByTestId('kpi-running-clocks');
      expect(within(runningCard).getByText('1')).toBeInTheDocument();

      // Overdue jobs = wo-2 is due in the past and not COMPLETE = 1
      const overdueCard = screen.getByTestId('kpi-overdue-jobs');
      expect(within(overdueCard).getByText('1')).toBeInTheDocument();

      // Quoted vs Actual calculation:
      // Total actual = 0 + 30 + 10 + 30 = 70 min = 1.2h
      // Total quoted = 90 + 60 + 60 + 30 = 240 min = 4.0h
      const varianceCard = screen.getByTestId('kpi-variance');
      expect(within(varianceCard).getByText(/1\.2h/)).toBeInTheDocument();
      expect(within(varianceCard).getByText(/\/ 4\.0h/)).toBeInTheDocument();
    });
  });

  describe('Search Filter Input', () => {
    it('filters work orders by WO number', () => {
      renderBoard();

      expect(screen.getByText('WO-1001')).toBeInTheDocument();
      expect(screen.getByText('WO-1002')).toBeInTheDocument();

      const searchInput = screen.getByLabelText('Search work orders');
      fireEvent.change(searchInput, { target: { value: 'WO-1001' } });

      expect(screen.getByText('WO-1001')).toBeInTheDocument();
      expect(screen.queryByText('WO-1002')).not.toBeInTheDocument();
      expect(screen.queryByText('WO-1003')).not.toBeInTheDocument();
      expect(screen.queryByText('WO-1004')).not.toBeInTheDocument();
    });

    it('filters work orders by description', () => {
      renderBoard();

      const searchInput = screen.getByLabelText('Search work orders');
      fireEvent.change(searchInput, { target: { value: 'Corrugated' } });

      expect(screen.getByText('WO-1002')).toBeInTheDocument();
      expect(screen.queryByText('WO-1001')).not.toBeInTheDocument();
      expect(screen.queryByText('WO-1003')).not.toBeInTheDocument();
    });

    it('filters work orders by customer name', () => {
      renderBoard();

      const searchInput = screen.getByLabelText('Search work orders');
      fireEvent.change(searchInput, { target: { value: 'Gamma' } });

      expect(screen.getByText('WO-1003')).toBeInTheDocument();
      expect(screen.queryByText('WO-1001')).not.toBeInTheDocument();
      expect(screen.queryByText('WO-1002')).not.toBeInTheDocument();
    });

    it('shows empty filter state when no search matches and allows clearing', () => {
      renderBoard();

      const searchInput = screen.getByLabelText('Search work orders');
      fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });

      expect(screen.getByText('No matching work orders')).toBeInTheDocument();
      const clearBtn = screen.getByRole('button', { name: /clear search/i });
      fireEvent.click(clearBtn);

      expect(screen.getByText('WO-1001')).toBeInTheDocument();
      expect(screen.getByText('WO-1002')).toBeInTheDocument();
    });
  });

  describe('Kanban Columns and Rendering', () => {
    it('renders all 4 Kanban columns with correct counts and cards', () => {
      renderBoard();

      // Planned column
      const plannedCol = screen.getByLabelText('Planned');
      expect(within(plannedCol).getByText('Planned')).toBeInTheDocument();
      expect(within(plannedCol).getByText('WO-1001')).toBeInTheDocument();

      // Released column
      const releasedCol = screen.getByLabelText('Released');
      expect(within(releasedCol).getByText('Released')).toBeInTheDocument();
      expect(within(releasedCol).getByText('WO-1002')).toBeInTheDocument();

      // In progress column
      const inProgressCol = screen.getByLabelText('In progress');
      expect(within(inProgressCol).getByText('In progress')).toBeInTheDocument();
      expect(within(inProgressCol).getByText('WO-1003')).toBeInTheDocument();

      // Complete column
      const completeCol = screen.getByLabelText('Complete');
      expect(within(completeCol).getByText('Complete')).toBeInTheDocument();
      expect(within(completeCol).getByText('WO-1004')).toBeInTheDocument();
    });
  });

  describe('View Switcher', () => {
    it('switches between Board and Gantt schedule view', () => {
      renderBoard();

      expect(screen.getByLabelText('Planned')).toBeInTheDocument();

      // Switch to Gantt view
      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      expect(screen.getByText('Floor Schedule & Timeline')).toBeInTheDocument();
      expect(screen.getByText('4 jobs scheduled')).toBeInTheDocument();
      expect(screen.queryByLabelText('Planned')).not.toBeInTheDocument();

      // Switch back to Board view
      const boardBtn = screen.getByRole('button', { name: /board view/i });
      fireEvent.click(boardBtn);

      expect(screen.getByLabelText('Planned')).toBeInTheDocument();
    });
  });

  describe('Slide-Over Work Order Drawer', () => {
    it('opens drawer on card click and displays details and operations', () => {
      renderBoard();

      // Click card WO-1001
      const card = screen.getByText('WO-1001').closest('[role="button"]')!;
      fireEvent.click(card);

      // Drawer dialog is open
      const drawer = screen.getByRole('dialog');
      expect(drawer).toBeInTheDocument();
      expect(within(drawer).getByText('Custom Folding Carton')).toBeInTheDocument();
      expect(within(drawer).getByText('1. Printing')).toBeInTheDocument();
      expect(within(drawer).getByText('SBS Paperboard')).toBeInTheDocument();

      // Link to Bench mode
      const benchLink = within(drawer).getAllByRole('link', { name: /open bench mode/i })[0];
      expect(benchLink).toHaveAttribute('href', '/production/wo-1');

      // Close drawer
      const closeBtn = screen.getByLabelText('Close drawer');
      fireEvent.click(closeBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Kanban Drag and Drop Transitions', () => {
    it('handles dropping onto Released column', async () => {
      const { api } = await import('@/lib/api/endpoints');
      renderBoard();

      const releasedCol = screen.getByLabelText('Released');
      fireEvent.drop(releasedCol, {
        dataTransfer: {
          getData: () => 'wo-1',
        },
      });

      await waitFor(() => {
        expect(api.workOrders.release).toHaveBeenCalledWith('wo-1');
      });
    });

    it('handles dropping onto In progress column to start pending operation', async () => {
      const { api } = await import('@/lib/api/endpoints');
      renderBoard();

      const inProgressCol = screen.getByLabelText('In progress');
      fireEvent.drop(inProgressCol, {
        dataTransfer: {
          getData: () => 'wo-1',
        },
      });

      // Releases first if planned, then starts pending op-1
      await waitFor(() => {
        expect(api.workOrders.start).toHaveBeenCalledWith('wo-1', 'op-1');
      });
    });

    it('opens completion dialog on dropping onto Complete and completes job', async () => {
      const { api } = await import('@/lib/api/endpoints');
      renderBoard();

      const completeCol = screen.getByLabelText('Complete');
      fireEvent.drop(completeCol, {
        dataTransfer: {
          getData: () => 'wo-2',
        },
      });

      // Dialog opens asking for completed quantity
      expect(screen.getByText('Complete WO-1002')).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: /confirm complete/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(api.workOrders.complete).toHaveBeenCalledWith('wo-2', 500);
      });
    });
  });

  describe('Card Quick Actions', () => {
    it('triggers release on planned card quick action button', () => {
      const mutateMock = vi.fn();
      vi.mocked(useWorkOrderAction).mockReturnValue({
        mutate: mutateMock,
        isPending: false,
      } as never);

      renderBoard();

      const releaseBtn = screen.getByLabelText('Release WO-1001');
      fireEvent.click(releaseBtn);

      expect(mutateMock).toHaveBeenCalledWith(
        { kind: 'release' },
        expect.objectContaining({ onSuccess: undefined }),
      );
    });

    it('triggers pause on running card quick action button', () => {
      const mutateMock = vi.fn();
      vi.mocked(useWorkOrderAction).mockReturnValue({
        mutate: mutateMock,
        isPending: false,
      } as never);

      renderBoard();

      const pauseBtn = screen.getByLabelText('Pause WO-1002');
      fireEvent.click(pauseBtn);

      expect(mutateMock).toHaveBeenCalledWith(
        { kind: 'stop', operationId: 'op-2' },
        expect.objectContaining({ onSuccess: undefined }),
      );
    });
  });
});
