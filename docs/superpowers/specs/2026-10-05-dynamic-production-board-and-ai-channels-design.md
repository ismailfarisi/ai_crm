# Dynamic Production Board, Gantt Chart & AI Channels Integration Design

**Date:** 2026-10-05  
**Status:** Approved  
**Scope:** Modernizing the shop floor Production Board into an interactive Jira-like Kanban and Gantt timeline, adding full production control skills to AI channels (Telegram/WhatsApp), and introducing an automated proactive check-in cron job.

---

## 1. Overview & Business Goals

Manufacturing operations on the shop floor need both agile tactical visibility (a real-time Kanban board with operation-level clarity and drag-and-drop) and long-range planning visibility (Gantt timeline across jobs and machines). Furthermore, shop floor operators and plant managers are frequently away from their desks; they require natural language channel interactions (via Telegram, WhatsApp, or Email) to update machine clocks, move jobs forward, query floor status, and receive proactive automated check-ins when operations run longer than estimated.

This design delivers:
1. **Dynamic Jira-like Production Board**: Drag-and-drop status transitions, visual operation mini-steppers on cards, card quick actions, slide-over detail drawer, and top-level KPI metrics bar.
2. **Production Gantt Chart**: Dual-mode interactive timeline toggleable between "By Work Order" (job delivery timeline) and "By Work Centre" (machine queue and capacity schedule).
3. **AI Channels Production Skills**: Natural language commands for starting/stopping clocks, moving operations, releasing/completing jobs, and querying shop floor status via Telegram/WhatsApp.
4. **Proactive AI Check-In Cron**: Automated background scanner that detects operations running past quoted estimates or stalled overdue jobs, reaches out to operators via Telegram, and executes their natural language updates seamlessly.

---

## 2. Shared Contracts & Types (`packages/shared`)

### 2.1 Channel Skills Registration
In `packages/shared/src/channels/skills.ts`:
```typescript
export const CHANNEL_SKILLS = {
  QUOTE_APPROVE: 'quote.approve',
  QUOTE_CREATE: 'quote.create',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  WORK_ORDER_LOG_TIME: 'work_order.log_time',
  WORK_ORDER_MANAGE: 'work_order.manage',
  WORK_ORDER_QUERY: 'work_order.query',
  DELIVERY_DISPATCH: 'delivery.dispatch',
  SALES_ORDER_FROM_DOCUMENT: 'sales_order.from_document',
} as const;

export type ChannelSkillName = (typeof CHANNEL_SKILLS)[keyof typeof CHANNEL_SKILLS];
```

### 2.2 Work Order Operation & Schedule Types
In `packages/shared/src/production/work-order.types.ts`:
```typescript
export interface WorkOrderGanttItem {
  id: string;
  woNumber: string;
  description: string;
  customerName?: string | null;
  status: WorkOrderStatus;
  startDate: string;
  dueDate: string | null;
  operations: {
    id: string;
    sequence: number;
    label: string;
    workCenterId: string;
    workCenterName: string;
    status: WorkOrderOperationStatus;
    estimatedMinutes: number;
    actualMinutes: number;
    runningSince?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
  }[];
}
```

---

## 3. Dynamic Kanban Board (Frontend)

Located in `apps/web/src/components/production/`:
- `production-board.tsx`: Main view controller housing the KPI bar, search/filters, and view switcher.
- `production-kanban.tsx`: The 4-column drag-and-drop board.
- `work-order-card.tsx`: Enhanced card with operation mini-stepper and quick actions.
- `work-order-drawer.tsx`: Slide-over drawer for in-depth job and operation tracking.

### 3.1 Header & Live KPI Strip
- **View Toggle**: Segmented control switching between `[ Kanban Board | Gantt Timeline ]`.
- **KPI Metrics Strip**:
  - *Active Jobs*: Count of jobs currently on the floor (`RELEASED` + `IN_PROGRESS`).
  - *Running Timers*: Live counter of machines/operations with active clocks running.
  - *Overdue Jobs*: Count of open jobs with `dueDate < today` (styled in red warning badge).
  - *Quoted vs Actual Time*: Aggregate shop floor time variance.
- **Search & Filters**:
  - Instant text filter by WO #, customer name, and product description.
  - Dropdown filter by Work Centre / Machine.
  - Due date filter (`All`, `Overdue`, `Today`, `This Week`, or custom date).

### 3.2 Drag-and-Drop Columns & Card Stepper
- **Columns**: `Planned` (1), `Released` (2), `In progress` (3), `Complete` (4).
- **Drag-and-Drop Workflow**:
  - Dragging from `Planned` to `Released`: Invokes `useWorkOrderAction(id).mutate({ kind: 'release' })` with optimistic placement.
  - Dragging to `In progress`: Prompts or directly starts the timer on the first pending operation.
  - Dragging to `Complete`: Opens a completion dialog pre-filling target quantity for confirmation, posting `complete`.
- **Card Operation Mini-Stepper**:
  - Displays a visual sequence of steps: `1. Print` → `2. Die Cut` → `3. Assembly`.
  - Step Status:
    - *Gray circle*: Pending.
    - *Emerald pulsing dot*: Active timer running (with ticking elapsed minutes).
    - *Solid checkmark*: Done.
- **Card Quick Actions**:
  - One-click Start/Pause button on the currently active machine step.
  - Quick "Release" button for planned jobs.
  - Click on card body opens the `WorkOrderDrawer`.

### 3.3 Slide-Over Floor Drawer (`work-order-drawer.tsx`)
- Opens smoothly on the right edge without disrupting board scroll or context.
- Contains:
  - **Header**: WO number, customer, status badge, sales order link, and due date.
  - **Operations Pipeline**: Detailed cards for each operation with operator assignment, machine cost, start/pause/finish clock controls, and live timer.
  - **Materials Table**: Issued vs planned stock with quick issue/return actions.
  - **Quick Time Log Form**: Add retrospective manual hours with notes.
  - "Open Bench Tablet Mode" button navigating to `/production/[id]`.

---

## 4. Production Gantt Chart (Frontend)

Located in `apps/web/src/components/production/production-gantt.tsx`.

### 4.1 Toggleable Perspectives
1. **By Work Order (Job Delivery Timeline)**:
   - Rows: One row per Work Order.
   - Timeline Bars: Overall job start to due date, segmented by operation blocks colored by status.
   - Purpose: Ensuring customer delivery dates are met and identifying delayed operations.
2. **By Work Centre / Machine (Machine Schedule & Capacity)**:
   - Rows: One row per Work Centre / Machine (e.g. *Press 01*, *Die Cutter*, *Gluing Table*).
   - Timeline Bars: Operations scheduled on that work centre over time.
   - Purpose: Machine load balancing, conflict identification, and maintenance scheduling.

### 4.2 Interactive Timeline Controls
- **Time Zoom**: Switch between `Day (Hours)`, `Week (Days)`, and `Month`.
- **Current Time Marker**: Accent vertical rule showing "Now".
- **Status Color Palette**:
  - *Planned*: Neutral muted slate / gray.
  - *Released*: Soft indigo.
  - *Running*: Amber / vibrant green with subtle pulse animation.
  - *Complete*: Forest emerald.
  - *Overdue*: Danger red.
- **Interactions**:
  - Hovering a bar reveals an information tooltip (WO #, operation label, customer, est vs actual hours, operator).
  - Clicking a bar or row opens the `WorkOrderDrawer` for immediate adjustment.

---

## 5. AI Channel Skills (`apps/api`)

### 5.1 `WorkOrderManageSkill` (`work_order.manage`)
- **File**: `apps/api/src/modules/channels/skills/work-order-manage.skill.ts`
- **Required Permissions**: `WORK_ORDER_EXECUTE` (and `WORK_ORDER_UPDATE` for release/complete/cancel).
- **Slot Schema**:
```typescript
const slotSchema = z.object({
  workOrderNumber: z.string().optional(),
  action: z.enum(['START', 'STOP', 'FINISH', 'RELEASE', 'COMPLETE', 'CANCEL', 'ADVANCE']).optional(),
  operationQuery: z.string().optional(),
  quantityCompleted: z.number().positive().optional(),
  cancelReason: z.string().optional(),
});
```
- **Execution Flow**:
  1. Identifies target `WorkOrder` by `WO-\d{4}-\d+` regex or description query.
  2. Resolves specific operation (e.g. "die cutting" matched against `operation.label` or `workCenterName`).
  3. Action Handlers:
     - `START`: Starts timer on operation; sets `operatorId` to sender's user ID.
     - `STOP`: Stops/pauses timer on operation; logs elapsed minutes.
     - `FINISH`: Stops clock and marks operation `DONE`. If next operation exists, queues or prompts to start.
     - `ADVANCE`: Marks current running step done and starts the next operation immediately.
     - `RELEASE`: Transitions job from `PLANNED` to `RELEASED`.
     - `COMPLETE`: If quantity is provided, marks job complete. If quantity missing, asks operator: *"How many good pieces were produced?"*.
     - `CANCEL`: Confirms reason before cancelling.

### 5.2 `WorkOrderQuerySkill` (`work_order.query`)
- **File**: `apps/api/src/modules/channels/skills/work-order-query.skill.ts`
- **Required Permissions**: `WORK_ORDER_READ`.
- **Slot Schema**:
```typescript
const slotSchema = z.object({
  queryType: z.enum(['ACTIVE_JOBS', 'JOB_STATUS', 'MACHINE_STATUS', 'OVERDUE_JOBS']).optional(),
  workOrderNumber: z.string().optional(),
  workCenterQuery: z.string().optional(),
});
```
- **Responses**:
  - Active jobs list: *"Currently running on the floor: WO-2026-0003 (Die cutting, 45m by Alex), WO-2026-0007 (Press, 1h 10m by Sam)."*
  - Single job detail: Status, operations progress (e.g. 2/3 done), actual vs estimated hours, due date.
  - Overdue alerts: Lists all jobs overdue with their current bottleneck operation.

---

## 6. Proactive AI Check-In Cron (`apps/api`)

### 6.1 Service Specification: `ProductionCheckInService`
- **File**: `apps/api/src/modules/production/production-check-in.service.ts`
- **Schedule**: `@Cron(CronExpression.EVERY_30_MINUTES)` during operational hours (e.g. 07:00 – 19:00).
- **Inspection Logic**:
  1. **Running Timer Over-Estimate**:
     - Finds all `work_order_operations` where `status = 'RUNNING'` and `runningSince IS NOT NULL`.
     - Calculates elapsed minutes: `Date.now() - runningSince.getTime()`.
     - If `actualMinutes + elapsedMinutes > estimatedSetupMinutes + estimatedRunMinutes`, flag for check-in.
  2. **Overdue / Stalled Jobs**:
     - Finds `work_orders` where `status IN ('RELEASED', 'IN_PROGRESS')` and `dueDate <= today`.
     - Checks if no operation has had a running timer in the past 2 hours.
- **Recipient Resolution**:
  1. Running operation's assigned `operatorId`.
  2. Work order's `createdById`.
  3. Fallback: Staff members with `WORK_ORDER_EXECUTE` linked to Telegram in that tenant.
- **Anti-Spam & Cooldown**:
  - In-memory/cache table tracking `(workOrderId, operationId, lastPingAt)`.
  - Enforces minimum 2-hour cooldown before re-pinging the same operation unless status changed.
- **Outbound Message Dispatch**:
  - Uses `ChannelsService.sendMessage(...)` with Telegram driver.
  - Format:
    > *"⏱️ Quick check-in: **WO-2026-0003** (*Rigid gift box*) has been running on **Die cutting** for 1h 45m (estimated 1h 00m). Is this step finished, still running, or delayed?"*
- **Conversational Continuation**:
  - The outbound check-in registers conversation state (`COLLECTING` on `work_order.manage` with `workOrderNumber` pre-filled).
  - When the operator replies:
    - *"Finished, move to folding"* → Finishes die cutting, starts folding, sends confirmation.
    - *"Need 20 more mins"* → Records note, resets cooldown.
    - *"Pause it for lunch"* → Pauses timer.

---

## 7. Testing & Verification Plan

### 7.1 Automated Unit & Integration Tests
- **API Channel Skills**:
  - `work-order-manage.skill.spec.ts`: Verify extraction and resolution for starting clocks, pausing, advancing operations, and completing jobs.
  - `work-order-query.skill.spec.ts`: Test querying active jobs, single WO details, and overdue filters.
- **Check-in Cron Service**:
  - `production-check-in.service.spec.ts`: Test criteria matching for over-estimate operations and stalled jobs, verify cooldown deduplication, and verify recipient resolution.
- **Frontend Board & Gantt**:
  - `production-board.spec.tsx`: Test column rendering, search filtering, KPI calculations, and view switching.
  - `production-gantt.spec.tsx`: Test timeline bar placements for Work Order mode and Work Centre mode.

### 7.2 Manual & End-to-End Verification
- Test drag-and-drop from `Planned` to `Released` and `Complete`.
- Verify card mini-steppers pulse when an operation clock is active.
- Verify opening and interacting with the slide-over `WorkOrderDrawer`.
- Send Telegram commands (*"start die cutting on WO-2026-0003"*) and verify instant database and UI reflection.
- Trigger check-in cron manually and verify outbound Telegram message delivery and reply handling.
