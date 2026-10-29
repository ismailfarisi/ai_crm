# Automations: run history and an approvals inbox — design

Status: draft for review, 2026-10-29.

## Why

Automations now run for real: they send email, change CRM records, call AI,
and start from events, webhooks and hourly schedules. But nobody can see what
a run did, and nothing in the app tells anyone that a run is waiting on them.

- Runs don't save what their steps did. `recordNodeResultActivity` is a stub,
  so `automation_executions` rows stay `RUNNING` with empty `nodeResults`
  forever (open in `docs/FLAGS.md`). The run detail endpoint asks Temporal
  instead. Temporal forgets closed runs after its retention period (one day on
  the staging setup), and after that the endpoint answers 503.
- The approve/reject endpoint exists (`POST /automations/executions/:id/signal`,
  `automation:approve`) but no screen calls it. Approval steps and AI agent
  actions awaiting sign-off just sit until they time out (three days by
  default). Since the last round, every AI agent action in a webhook run waits
  for approval. A scheduled automation whose run is waiting skips its later
  ticks, so an hourly job stalls silently.
- `ExecutionTraceDrawer` exists in the web app but nothing renders it.

## Goals

1. Each run keeps a lasting record of what every step did, and its real final
   status, in the database. No screen depends on Temporal remembering it.
2. A **Runs** view in each automation's editor: a list of its runs, and a
   detail view showing step by step what happened.
3. One **Approvals** inbox for the whole organisation, listing everything
   waiting on a person, where anyone with the `automation:approve` permission
   can approve or reject it.

## Non-goals (this round)

- Re-running a failed run.
- Email, Slack or in-app notifications when something needs approval.
- Assigning an approval to a specific person or role. **Decided by the user:
  anyone holding `automation:approve` may decide any item.**
- Highlighting a run's path on the canvas. The detail view is a step list.
- Pruning or archiving old runs. Rows are kept.
- An organisation-wide "all runs" list across automations.

## Anti-goals (would make it a failure even if it works)

- A run that finished shows as "Running", or one waiting on a person doesn't
  show as waiting.
- Two people approve the same item and both think their decision counted. The
  first decision wins, and the second person is told who decided first.
- A user can see runs or approvals of another organisation.
- An approval in the inbox that can no longer be decided (timed out, run gone)
  still offers Approve. An approval that times out must not show "approved".
- The inbox shows the approver less than they need to decide: which automation,
  what started the run, and what will happen.

## Part 1 — runs record what happened (decided)

The `automation_executions` row becomes the record of a run. The workflow
writes it as it goes. Screens read only the database.

- **Per step.** `recordNodeResultActivity` gets a real body. It is already
  called when a step starts waiting, succeeds, or fails, with the step's id,
  type, status, input, output, error, start and finish times, and duration. It
  merges that step into `nodeResults` (keyed by step id) and sets the row's
  `status` (`WAITING_APPROVAL` while any approval is pending, otherwise
  `RUNNING`). It runs in the run's tenant with RLS like the other automation
  activities, and it must be safe to retry. The write is a JSONB merge of one
  key, so a retry rewrites the same value.
- **Size cap (my call).** Each step's stored `input` and `output` is capped at
  16 KB of JSON. Larger values are replaced by a truncated preview plus
  `"truncated": true`. An HTTP step that fetches a megabyte page must not bloat
  the row.
- **Step label and type.** Store each step's `label` and `type` alongside its
  result, so the history still reads correctly after someone edits or deletes
  that step from the automation.
- **End of run.** A new activity writes the final `status` (`COMPLETED` or
  `FAILED`), `finishedAt` and `errorMessage` at every return point of
  `dynamicDagWorkflow`, including the early "no start node" return. Any of
  this run's approvals still pending at that moment become `CANCELLED`.
- **In-flight runs across the deploy.** Adding activity calls to the workflow
  changes its command history. New workflow commands go behind Temporal's
  `patched()`, so runs started before the deploy replay cleanly.
- **Runs from before this ships** have no recorded steps and may say
  `RUNNING` forever. None of them may keep showing as running. The builder
  picks how, as long as the outcome is shown honestly as unknown and not as
  success or failure. Example: a migration marks old open rows that have no
  recorded steps, and the UI says "Details weren't recorded for this run."
- **Run source (my call).** Add a `triggerSource` column to
  `automation_executions`: `event`, `webhook`, `schedule` or `test`. It is set
  when the run is created (the start paths already know which one). The list
  shows it. Old rows stay null and display as "—".
- **Detail endpoint.** `GET /automations/executions/:executionId` reads only
  the database, with no Temporal query and no 503. The test-run drawer keeps
  working, because steps are now written as they happen.

## Part 2 — run history (decided)

**Where.** The automation editor gets a **Runs** panel, opened from the toolbar
(next to Test run). It is visible to anyone with `automation:read`.

**List.** Newest first, 25 per page with "Load more". Each row shows:
- when the run started, as relative time with the exact time on hover
- the source (Event / Webhook / Schedule / Test)
- the status as a chip: Running, Waiting for approval, Completed, Failed,
  Cancelled, or Unknown for runs from before this change
- the duration, once the run has finished

A status filter offers All, Failed, Waiting for approval and Completed. While
the panel is open and any listed run is Running or Waiting, the list refreshes
every 5 seconds.

**Detail.** Opening a run shows:
- a header with the status, source, started and finished times, and the error
  message if the run failed
- what started the run: the trigger payload, collapsed and expandable as JSON
- the steps in the order they ran (by `startedAt`), each with its label, type,
  status, duration and error. Each step expands to show its input and output
  as JSON.
- for a step that is waiting on approval, the same decision controls as the
  inbox (below), shown to users with `automation:approve`

Reuse or replace `ExecutionTraceDrawer`. Nothing renders it today.

**API.** `GET /automations/:id/executions` gets paging (`limit`, cursor on
`startedAt`/`id`) and a `status` filter. The list response leaves out the
heavy `nodeResults` and `triggerPayload`. The detail call carries those.

## Part 3 — the approvals inbox (decided)

**Data (my call).** A new tenant table `automation_approvals`. The inbox needs
a cross-automation query and a count, which `nodeResults` can't serve. One row
per request:

- `id`, `tenantId`, `executionId`, `workflowId`, `nodeId`
- `kind`: `step` (an Approval step) or `agent_action` (an AI agent tool waiting
  for sign-off)
- `title`: the step's label
- `details`: JSONB. For a step, its message (below). For an agent action, the
  tool name and the preview the skill produced.
- `requestedAt`, `expiresAt`: from the step's timeout, default 3 days
- `status`: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED` or `CANCELLED`
- `decidedByUserId`, `decidedAt`, `comment`: the comment or reject reason

It follows the existing tenant RLS pattern with the policy in the migration.
At most one `PENDING` row exists per (execution, node). An agent step can ask
again for its next tool after a decision, which makes a new row. The
workflow's existing approval-waiting record call creates the row, and creating
it is idempotent: a retried activity doesn't make a second row.

**Deciding.**
- `POST /automations/approvals/:approvalId/decision` with `{ action:
  'APPROVE' | 'REJECT', comment? }` requires `automation:approve`.
- It checks the run's live Temporal state, as `signalExecution` does today.
- It claims the row with a conditional update (`WHERE status = 'PENDING'`).
  Losing the race answers 409 with who decided and when.
- It then sends the signal, now including `approvedBy`/`rejectedBy` set to
  the user's id, so the step's recorded output says who decided. If the signal
  can't be delivered, it puts the row back to `PENDING` and answers 503.
- The existing `POST /automations/executions/:id/signal` keeps working and
  goes through the same claim, so the two paths can't disagree.
- `AuditInterceptor` records the decision. Add the approvals subject in
  `audit-subjects.ts` if it needs one.
- **Expiry.** When an approval step times out, the step's record marks its
  approval `EXPIRED`. When an agent action times out inside the child
  workflow, the end-of-run sweep (Part 1) closes the row as `CANCELLED`. The
  sweep marks `EXPIRED` instead when `expiresAt` has passed.

**Inbox screen.**
- Lives at `/automations/approvals`. It gets a nav item "Approvals" whose rule
  and page guard are both `automation:approve`. The automations list page
  links to it.
- Lists `PENDING` items oldest first. Each item shows:
  - the automation name, linking to the editor
  - the kind: "Approval step" or "AI action"
  - the title
  - what started the run (source and a short trigger summary)
  - when it was requested
  - how long until it times out, with what happens then: "takes the timeout
    path" for steps, "the action is dropped" for agent actions
  - the details: the step message, or the tool and its preview
  - Approve and Reject buttons with an optional comment box. Reject asks for
    the reason in the same box.
- After a decision the item leaves the list. If someone else decided first,
  the item says so ("Already approved by Ana, 2 minutes ago") and leaves.
- Empty state: "Nothing is waiting for approval."
- **Count.** The nav item shows the number of `PENDING` items, from `GET
  /automations/approvals/count`, refreshed every 60 seconds and after a
  decision. The nav has no badge support today, so add an optional count to
  nav items. Hide the badge when the count is 0.

**List API.** `GET /automations/approvals?status=PENDING` (default) requires
`automation:approve`. It returns the items with the automation name and the
run's source and trigger summary joined in, so the inbox makes one call.

**Approval step changes.**
- The canvas card today shows "Approver: admin" from an `approverRole` config
  that nothing enforces. Since anyone with the permission decides, drop that
  line from the card and stop writing `approverRole` for new steps. Ignore it
  on existing steps.
- Add an optional **"Message for the approver"** field to the Approval step
  inspector (my call). It supports `{{ }}` expressions such as
  `{{ $trigger.payload.name }}` and is resolved when the step starts waiting.
  It is shown as the item's details. Without it, an inbox item for a plain
  approval step would only say the step's label.

## Decisions from the builder check (my calls)

- **Who sees run contents.** `automation:read` is held by the member and
  viewer roles, and a run's payloads can hold whole contacts, email bodies and
  AI output. People who can read automations see the run list and each step's
  label, type, status, timing and error. Payloads are shown only to holders of
  `automation:update`: the trigger payload, step input and output, and an
  agent action's preview. Those people build automations and can already see
  everything the steps do. The detail endpoint omits the payload fields for
  everyone else, and the panel says "You can't see the data in this run."
  Approvers additionally see the inbox details (the step message, or the tool
  and its preview), because they can't decide without them.
- **Runs that never reach a return point.** Wrap the workflow body so that any
  thrown error still records `FAILED` with its message. Where a run's Temporal
  start fails, the start path marks the row `FAILED` ("Couldn't start the
  run"), in `triggerExecution` and the test run alike. Runs that are
  terminated, time out, or stick on a workflow-task error remain a known gap.
  Note it in FLAGS.md. No periodic cleanup job this round.
- **Runs open at deploy.** No backfill of approval rows. The migration marks
  every open row that has no recorded steps as unknown (a new `UNKNOWN`
  status). A live workflow that later records steps or a final status
  overwrites it, because true information wins. Before deploying, check
  production for open runs. Any that are waiting on an approval are left to
  time out, since it's a demo tenant. Report what was found.
- **Waiting → running.** After a decision is claimed, the API sets the run
  back to `RUNNING` if no other approval of that run is still pending. The
  workflow's next step record confirms it.
- **Agent actions that time out.** When the agent step finishes or fails, any
  approval of that step still `PENDING` is closed: `EXPIRED` if `expiresAt`
  has passed, otherwise `CANCELLED`. The end-of-run sweep stays as the
  backstop.

## Data / migrations

- `automation_executions`: add `triggerSource` (nullable varchar or enum).
  Add `UNKNOWN` to the status enum and close out pre-existing open rows as
  described in the builder-check decisions.
- New table `automation_approvals` with RLS policy, an index on
  `(tenantId, status, requestedAt)`, and a partial unique index on
  `(executionId, nodeId) WHERE status = 'PENDING'`. FK to `automation_executions`
  with `ON DELETE CASCADE`, so deleting an automation removes its approvals
  along with its runs.
- `pnpm check:drift` stays green.

## Testing

- Activity unit tests: a step merge writes one key; a retry is idempotent; the
  16 KB cap truncates; the waiting status flips back to running after a
  decision; final status and the approval sweep happen at both workflow return
  points.
- Workflow tests (existing `dynamic-dag.workflow.spec.ts` style): the recording
  activities are called with the right arguments; `patched()` guards the new
  calls.
- Service tests: the first decision wins; the second gets 409 with the
  decider; a failed signal restores `PENDING`; a user without
  `automation:approve` is refused; another tenant's approval is 404.
- Web tests: the Runs panel list, filter, detail and polling stop; inbox render,
  approve, reject with a reason, the "already decided" message, the empty
  state; the nav badge hidden at 0.
- Live check on switeaz.com after deploy, as in earlier rounds:
  - a webhook automation with an Approval step: the run shows as Waiting, the
    inbox lists it with its message, approving it continues the run, and the
    history shows every step and who approved
  - a failing step shows its error in the history
  - the test automations are cleaned up afterwards

## Left to the builder

- The exact layout and components, following the existing studio drawers and
  app page patterns.
- How old open runs are closed out, within the Part 1 rule.
- The trigger-summary wording per source, for example "contact.created —
  Ana Lee", "Webhook", or "Schedule, 14:00 Gulf time".
- Whether the Runs panel is a drawer or a tab, as long as it opens from the
  editor toolbar.
