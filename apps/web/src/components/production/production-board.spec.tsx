import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkOrderDto } from '@saas/shared';
import { DEFAULT_BOARD_COLUMNS, type ProductionBoardColumn } from '@saas/shared';
import { toast } from 'sonner';
import { ProductionBoard } from './production-board';
import { useWorkOrders, useWorkOrder, useWorkOrderAction } from '@/hooks/use-work-orders';
import { useBoardColumns } from '@/hooks/use-board-columns';
import { useCan } from '@/lib/session-context';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock('@/hooks/use-work-orders', () => ({
  useWorkOrders: vi.fn(),
  useWorkOrder: vi.fn(),
  useWorkOrderAction: vi.fn(),
}));

vi.mock('@/hooks/use-board-columns', () => ({
  useBoardColumns: vi.fn(),
}));

vi.mock('@/lib/session-context', () => ({
  useCan: vi.fn(),
}));

vi.mock('@/lib/api/endpoints', () => {
  const defaultCols = [
    { id: 'planned', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
    { id: 'released', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
    { id: 'in_progress', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
    { id: 'complete', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
  ];
  const updateColumnMock = vi.fn().mockImplementation(async (id: string, colId: string) => ({ id, columnId: colId }));
  return {
    api: {
      board: {
        getColumns: vi.fn().mockResolvedValue(defaultCols),
        updateColumns: vi.fn().mockImplementation(async (cols: any) => cols),
      },
      workOrders: {
        updateColumn: updateColumnMock,
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
    productionKeys: {
      boardColumns: vi.fn(() => ['production-board-columns']),
      workOrders: vi.fn(() => ['work-orders']),
      workOrder: vi.fn((id: string) => ['work-orders', id]),
    },
  };
});

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
    vi.clearAllMocks();
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
    vi.mocked(useBoardColumns).mockReturnValue({
      columns: DEFAULT_BOARD_COLUMNS,
      isLoading: false,
      updateColumns: vi.fn(),
      addColumn: vi.fn(),
      editColumn: vi.fn(),
      deleteColumn: vi.fn(),
      moveColumn: vi.fn(),
      isUpdating: false,
    });
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

    it('counts each running operation as a clock', () => {
      const workOrdersWithTwoRunningOps = mockWorkOrders.map((wo) =>
        wo.id === 'wo-2'
          ? {
              ...wo,
              operations: [
                ...wo.operations,
                { ...wo.operations[0], id: 'op-2b', sequence: 2 },
              ],
            }
          : wo,
      );
      vi.mocked(useWorkOrders).mockReturnValue({
        data: workOrdersWithTwoRunningOps,
        isPending: false,
        isError: false,
        error: null,
      } as never);

      renderBoard();

      const runningCard = screen.getByTestId('kpi-running-clocks');
      expect(within(runningCard).getByText('2')).toBeInTheDocument();
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

  describe('Production Gantt Chart View', () => {
    it('renders Gantt chart rows in By Work Order mode and displays WO details and overdue indicators', () => {
      renderBoard();

      // Switch to Gantt view
      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      expect(screen.getByText('Floor Schedule & Timeline')).toBeInTheDocument();
      expect(screen.getByText('4 jobs scheduled')).toBeInTheDocument();

      // Check By Work Order button is pressed
      const workOrderModeBtn = screen.getByRole('button', { name: /by work order/i });
      expect(workOrderModeBtn).toHaveAttribute('aria-pressed', 'true');

      // Verify work order numbers in the left column
      expect(screen.getByText('WO-1001')).toBeInTheDocument();
      expect(screen.getByText('WO-1002')).toBeInTheDocument();
      expect(screen.getByText('WO-1003')).toBeInTheDocument();
      expect(screen.getByText('WO-1004')).toBeInTheDocument();

      // Verify descriptions and customer names
      expect(screen.getByText('Custom Folding Carton')).toBeInTheDocument();
      expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();

      // WO-1002 is overdue
      expect(screen.getByText('Overdue')).toBeInTheDocument();

      // Check Today marker
      expect(screen.getAllByTestId('gantt-today-marker').length).toBeGreaterThanOrEqual(1);
    });

    it('switches between By Work Order and By Work Centre views', () => {
      renderBoard();

      // Switch to Gantt view
      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      // Switch to By Work Centre mode
      const workCenterModeBtn = screen.getByRole('button', { name: /by work centre/i });
      fireEvent.click(workCenterModeBtn);

      expect(workCenterModeBtn).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByText(/indicative timing from job dates; machine bookings are not scheduled/i),
      ).toBeInTheDocument();

      // Scope queries within Gantt section (since top filter dropdown also has work centre options)
      const ganttSection = screen.getByLabelText('Production Gantt Schedule');
      expect(within(ganttSection).getByText('Offset Press')).toBeInTheDocument();
      expect(within(ganttSection).getByText('Flatbed Cutter')).toBeInTheDocument();
      expect(within(ganttSection).getByText('Bench Assembly')).toBeInTheDocument();

      // Operation counts on machines
      expect(screen.getByText('2 operations')).toBeInTheDocument();

      // Switch back to By Work Order mode
      const woModeBtn = screen.getByRole('button', { name: /by work order/i });
      fireEvent.click(woModeBtn);

      expect(woModeBtn).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Custom Folding Carton')).toBeInTheDocument();
    });

    it('toggles time scales between Day, Week, and Month', () => {
      renderBoard();

      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      // Default is Month
      const monthBtn = screen.getByRole('button', { name: /month zoom/i });
      expect(monthBtn).toHaveAttribute('aria-pressed', 'true');

      // Switch to Day
      const dayBtn = screen.getByRole('button', { name: /day zoom/i });
      fireEvent.click(dayBtn);
      expect(dayBtn).toHaveAttribute('aria-pressed', 'true');
      expect(monthBtn).toHaveAttribute('aria-pressed', 'false');

      // Switch to Week
      const weekBtn = screen.getByRole('button', { name: /week zoom/i });
      fireEvent.click(weekBtn);
      expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
      expect(dayBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('navigates timeline window using Prev, Today, and Next controls', () => {
      renderBoard();

      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      const nextBtn = screen.getByRole('button', { name: /next period/i });
      const prevBtn = screen.getByRole('button', { name: /previous period/i });
      const todayBtn = screen.getByRole('button', { name: /today/i });

      fireEvent.click(nextBtn);
      expect(nextBtn).toBeInTheDocument();

      fireEvent.click(prevBtn);
      fireEvent.click(prevBtn);
      expect(prevBtn).toBeInTheDocument();

      fireEvent.click(todayBtn);
      expect(todayBtn).toBeInTheDocument();
    });

    it('clicking a Gantt bar opens the slide-over WorkOrderDrawer', () => {
      renderBoard();

      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      const bars = screen.getAllByTestId('gantt-bar');
      expect(bars.length).toBeGreaterThan(0);

      // Click the first bar
      fireEvent.click(bars[0]);

      // Drawer dialog is open
      const drawer = screen.getByRole('dialog');
      expect(drawer).toBeInTheDocument();
      expect(within(drawer).getByText('Custom Folding Carton')).toBeInTheDocument();
      expect(within(drawer).getByText('1. Printing')).toBeInTheDocument();
    });

    it('displays hover tooltip on operation segments', () => {
      renderBoard();

      const ganttBtn = screen.getByRole('button', { name: /gantt view/i });
      fireEvent.click(ganttBtn);

      // Find segment with title
      const segment = screen.getByTitle(/WO: WO-1001/);
      expect(segment).toBeInTheDocument();
      expect(segment).toHaveAttribute('title', expect.stringContaining('Offset Press'));
      expect(segment).toHaveAttribute('title', expect.stringContaining('Acme Corp'));
      expect(segment).toHaveAttribute('title', expect.stringContaining('Status: PENDING'));

      // Hover triggers tooltip
      fireEvent.mouseEnter(segment);
      const tooltip = screen.getByTestId('gantt-tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(within(tooltip).getByText('WO-1001')).toBeInTheDocument();
      expect(within(tooltip).getByText('Acme Corp')).toBeInTheDocument();

      // Mouse leave hides tooltip
      fireEvent.mouseLeave(segment);
      expect(screen.queryByTestId('gantt-tooltip')).not.toBeInTheDocument();
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
          getData: () => 'wo-3',
        },
      });

      // Dialog opens asking for completed quantity
      expect(screen.getByText('Complete WO-1003')).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: /confirm complete/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(api.workOrders.complete).toHaveBeenCalledWith('wo-3', 200, 'complete');
      });
    });

    it('blocks completing a job that is still PLANNED', () => {
      renderBoard();

      const completeCol = screen.getByLabelText('Complete');
      fireEvent.drop(completeCol, {
        dataTransfer: {
          getData: () => 'wo-1',
        },
      });

      expect(toast.error).toHaveBeenCalledWith('Release the work order before completing it');
      expect(screen.queryByText('Complete WO-1001')).not.toBeInTheDocument();
    });

    it('blocks completing a job that has RUNNING operations', () => {
      renderBoard();

      const completeCol = screen.getByLabelText('Complete');
      fireEvent.drop(completeCol, {
        dataTransfer: {
          getData: () => 'wo-2',
        },
      });

      expect(toast.error).toHaveBeenCalledWith('Stop running operations before completing the job');
      expect(screen.queryByText('Complete WO-1002')).not.toBeInTheDocument();
    });

    it('blocks drop transition when user lacks permission', () => {
      vi.mocked(useCan).mockReturnValue(false);
      renderBoard();

      const releasedCol = screen.getByLabelText('Released');
      fireEvent.drop(releasedCol, {
        dataTransfer: {
          getData: () => 'wo-1',
        },
      });

      expect(toast.error).toHaveBeenCalledWith("You don't have permission to update work order status");
    });

    it('blocks dropping onto In progress when user lacks execute or update permission', () => {
      vi.mocked(useCan).mockReturnValue(false);
      renderBoard();

      const inProgressCol = screen.getByLabelText('In progress');
      fireEvent.drop(inProgressCol, {
        dataTransfer: {
          getData: () => 'wo-1',
        },
      });

      expect(toast.error).toHaveBeenCalledWith("You don't have permission to release and start work orders");
    });

    it('disables dragging on completed cards', () => {
      renderBoard();

      const completedCard = screen.getByText('WO-1004').closest('[role="button"]')!;
      expect(completedCard).toHaveAttribute('draggable', 'false');

      const plannedCard = screen.getByText('WO-1001').closest('[role="button"]')!;
      expect(plannedCard).toHaveAttribute('draggable', 'true');
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

  describe('Dynamic Custom Kanban Columns & Actions', () => {
    const customColumns: ProductionBoardColumn[] = [
      { id: 'planned', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
      { id: 'released', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
      { id: 'in_progress', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
      { id: 'col-qc', name: 'QC Inspection', status: 'IN_PROGRESS', color: 'purple', sequence: 3, isDefault: false },
      { id: 'col-packaging', name: 'Packaging', status: 'IN_PROGRESS', color: 'cyan', sequence: 4, isDefault: false },
      { id: 'complete', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 5, isDefault: true },
    ];

    it('renders all custom column headers including newly added ones', () => {
      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      expect(screen.getByLabelText('QC Inspection')).toBeInTheDocument();
      expect(screen.getByLabelText('Packaging')).toBeInTheDocument();
      expect(screen.getByLabelText('Planned')).toBeInTheDocument();
      expect(screen.getByLabelText('Released')).toBeInTheDocument();
      expect(screen.getByLabelText('In progress')).toBeInTheDocument();
      expect(screen.getByLabelText('Complete')).toBeInTheDocument();
    });

    it('renders cards under their assigned custom column via parameters.columnId', () => {
      const workOrdersWithCustomCols: WorkOrderDto[] = [
        {
          ...mockWorkOrders[2],
          id: 'wo-custom-qc',
          woNumber: 'WO-9001',
          status: 'IN_PROGRESS',
          parameters: { columnId: 'col-qc' },
        },
        {
          ...mockWorkOrders[2],
          id: 'wo-custom-pkg',
          woNumber: 'WO-9002',
          status: 'IN_PROGRESS',
          parameters: { columnId: 'col-packaging' },
        },
      ];

      vi.mocked(useWorkOrders).mockReturnValue({
        data: workOrdersWithCustomCols,
        isPending: false,
        isError: false,
        error: null,
      } as never);

      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      const qcCol = screen.getByLabelText('QC Inspection');
      expect(within(qcCol).getByText('WO-9001')).toBeInTheDocument();

      const pkgCol = screen.getByLabelText('Packaging');
      expect(within(pkgCol).getByText('WO-9002')).toBeInTheDocument();
    });

    it('falls back cards with missing or deleted columnId to the default status column', () => {
      const workOrdersWithDeletedCol: WorkOrderDto[] = [
        {
          ...mockWorkOrders[2], // status: 'IN_PROGRESS'
          id: 'wo-fallback',
          woNumber: 'WO-9003',
          parameters: { columnId: 'deleted-non-existent-column' },
        },
      ];

      vi.mocked(useWorkOrders).mockReturnValue({
        data: workOrdersWithDeletedCol,
        isPending: false,
        isError: false,
        error: null,
      } as never);

      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      // Should fallback to default 'In progress' column
      const inProgressCol = screen.getByLabelText('In progress');
      expect(within(inProgressCol).getByText('WO-9003')).toBeInTheDocument();
    });

    it('clicking + Add Column opens modal and calls addColumn on submit', async () => {
      const addColumnMock = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: addColumnMock,
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      const addBtn = screen.getByRole('button', { name: /\+? ?add column/i });
      fireEvent.click(addBtn);

      expect(screen.getByText('Add Board Column')).toBeInTheDocument();

      const nameInput = screen.getByLabelText(/column title/i);
      fireEvent.change(nameInput, { target: { value: 'Surface Coating' } });

      const submitBtn = screen.getByRole('button', { name: /create column/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(addColumnMock).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Surface Coating',
            status: 'IN_PROGRESS',
          }),
        );
      });
    });

    it('opens kebab menu and triggers editColumn', async () => {
      const editColumnMock = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: editColumnMock,
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      const kebabBtn = screen.getByLabelText('Column options for QC Inspection');
      fireEvent.click(kebabBtn);

      const editMenuItem = screen.getByRole('menuitem', { name: /edit column/i });
      fireEvent.click(editMenuItem);

      expect(screen.getByText('Edit Board Column')).toBeInTheDocument();
      const nameInput = screen.getByLabelText(/column title/i);
      expect(nameInput).toHaveValue('QC Inspection');

      fireEvent.change(nameInput, { target: { value: 'Quality Control (QC)' } });
      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(editColumnMock).toHaveBeenCalledWith(
          'col-qc',
          expect.objectContaining({
            name: 'Quality Control (QC)',
          }),
        );
      });
    });

    it('reorders columns via Move Left and Move Right in kebab menu', async () => {
      const moveColumnMock = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: moveColumnMock,
        isUpdating: false,
      });

      renderBoard();

      const kebabBtn = screen.getByLabelText('Column options for QC Inspection');
      fireEvent.click(kebabBtn);

      const moveLeftItem = screen.getByRole('menuitem', { name: /move left/i });
      fireEvent.click(moveLeftItem);

      await waitFor(() => {
        expect(moveColumnMock).toHaveBeenCalledWith('col-qc', 'left');
      });
    });

    it('disables delete on default column and enables on custom column', async () => {
      const deleteColumnMock = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: deleteColumnMock,
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      // Check on default column 'Planned'
      const plannedKebab = screen.getByLabelText('Column options for Planned');
      fireEvent.click(plannedKebab);
      const deletePlannedBtn = screen.getByRole('menuitem', { name: /delete column/i });
      expect(deletePlannedBtn).toBeDisabled();

      // Now click on custom column 'QC Inspection'
      const qcKebab = screen.getByLabelText('Column options for QC Inspection');
      fireEvent.click(qcKebab);
      const deleteQcBtn = screen.getByRole('menuitem', { name: /delete column/i });
      expect(deleteQcBtn).not.toBeDisabled();
      fireEvent.click(deleteQcBtn);

      await waitFor(() => {
        expect(deleteColumnMock).toHaveBeenCalledWith('col-qc');
      });
    });

    it('shows active column badge in work order drawer and updates on column change', async () => {
      const { api } = await import('@/lib/api/endpoints');
      const woWithCol: WorkOrderDto = {
        ...mockWorkOrders[0],
        id: 'wo-with-col',
        status: 'IN_PROGRESS',
        parameters: { columnId: 'col-qc' },
      };

      vi.mocked(useWorkOrders).mockReturnValue({
        data: [woWithCol],
        isPending: false,
        isError: false,
        error: null,
      } as never);

      vi.mocked(useWorkOrder).mockReturnValue({
        data: woWithCol,
        isPending: false,
        isError: false,
        error: null,
      } as never);

      vi.mocked(useBoardColumns).mockReturnValue({
        columns: customColumns,
        isLoading: false,
        updateColumns: vi.fn(),
        addColumn: vi.fn(),
        editColumn: vi.fn(),
        deleteColumn: vi.fn(),
        moveColumn: vi.fn(),
        isUpdating: false,
      });

      renderBoard();

      // Click card to open drawer
      const card = screen.getByText('WO-1001').closest('[role="button"]')!;
      fireEvent.click(card);

      // Verify drawer shows column badge
      const drawer = screen.getByRole('dialog');
      expect(within(drawer).getByTestId('drawer-column-badge')).toHaveTextContent('QC Inspection');

      // Change column using dropdown
      const columnSelect = within(drawer).getByLabelText('Switch board column');
      fireEvent.change(columnSelect, { target: { value: 'col-packaging' } });

      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(api.workOrders.updateColumn).toHaveBeenCalledWith('wo-with-col', 'col-packaging');
      });
    });
  });
});
