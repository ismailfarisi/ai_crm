# Phase 3 Design Specification: Canvas Observability & Test Sandbox UX

## 1. Executive Summary & Objective

Phase 3 modernizes the frontend workflow builder in `apps/web` (`@xyflow/react`) to provide visual execution observability and an interactive testing sandbox:
1. **Live Execution Trace Overlay**: Real-time visual feedback on the canvas showing which path an automation execution traversed (success in emerald, approval wait in amber, failure in rose).
2. **Node I/O & Telemetry Inspector**: Clicking any executed node reveals its exact `$json` context, raw HTTP/CRM payloads, multi-turn AI reasoning steps, and token costs.
3. **Dry-Run Test Sandbox**: Allows builders to run any DAG against real CRM records without committing database mutations or triggering real emails/webhooks.

---

## 2. Core Capabilities

### 2.1 Live Execution Trace Overlay
- Integrates with `WorkflowExecutionState` streamed via SSE or queried from `/api/automations/:id/executions/:execId`.
- Nodes receive animated visual states:
  - **`RUNNING` (Blue pulsing border)**: Current active node.
  - **`SUCCESS` (Emerald border + badge)**: Finished successfully, displaying execution time (e.g. `124ms`).
  - **`WAITING_APPROVAL` (Amber banner)**: Paused waiting for human reviewer approval.
  - **`FAILED` (Rose border + error icon)**: Errored step with clickable stack trace.
  - **`SKIPPED` (Faded opacity)**: Untraversed conditional branches.
- Edges that were traversed glow green (`stroke: #10b981, strokeWidth: 3`), visually tracing the exact DAG pathway taken.

### 2.2 Node I/O & Telemetry Inspector
- Embedded drawer sliding out from the right:
  - **Input Tab**: Exact evaluated variables passed into the node.
  - **Output Tab**: Formatted JSON response produced by the node.
  - **AI Telemetry Tab** (for `aiAgentNode` and `aiPromptNode`):
    - Multi-turn thought reasoning loops.
    - Tool calls executed (e.g. `query_custom_record`, `calculate_quote`).
    - Token metrics: Prompt tokens, Completion tokens, and estimated USD spend.

### 2.3 Dry-Run Sandbox Runner
- "Test Run" button in the canvas toolbar.
- Opens record picker modal to select an existing record (e.g. a Deal or Lead) to serve as `$trigger` data.
- Executes workflow in `mode: 'DRY_RUN'`:
  - `executeCrmMutationActivity` simulates mutations and returns staged records without calling `repository.save()`.
  - `executeEmailActivity` mocks delivery and logs message output to execution state.
  - Builder sees immediate visual results on canvas before publishing the automation to production.
