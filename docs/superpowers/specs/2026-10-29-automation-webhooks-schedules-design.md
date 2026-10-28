# Automations: webhook and schedule triggers — design

Date: 2026-10-29
Status: builder check done; awaiting product owner approval

## Why

Two of the four automation triggers don't work:

- **Webhooks always 404.** `POST /automations/webhook/:slug` is public, so no
  tenant is set, and row-level security (the API's DB role has `NOBYPASSRLS`)
  hides the workflow from `findOne({ where: { webhookSlug } })`. The slug is
  also guessable (`wh_<timestamp>_<5 chars>`), and a DRAFT or PAUSED workflow
  would fire if the lookup worked.
- **Schedules never run.** Activating a SCHEDULE automation stores a cron
  string and nothing ever schedules it.

The product owner wants both working, for any sender ("every option is
valid": website forms, Zapier/Make, partner systems, scripts) and for
schedules down to hourly.

## Goals

1. A webhook automation, once ACTIVE, starts a run for every valid POST to its
   address, from any HTTP client including a plain HTML form.
2. A schedule automation, once ACTIVE, runs on its schedule (hourly at the
   finest), in a chosen time zone, until it is paused, deactivated or deleted.
3. Both run as the automation's owner (`activatedByUserId`), exactly like CRM
   event runs, with the real actions built in the previous round.

## Non-goals

- Run history screen and approvals screen (next round).
- Sub-hourly schedules, raw cron input.
- IP allow-lists, mutual TLS, OAuth for webhook senders.
- SSRF hardening of the HTTP Request step.
- Changing who the AI agent step acts as in CRM-event runs (webhook and
  schedule runs: see decision 5).

## Anti-goals

- **The payload choosing authority.** Webhook data is untrusted. It may fill
  in step fields through `{{ $trigger.payload… }}`, but it never selects the
  actor, the owner or the tenant.
- **A probe-able endpoint.** Unknown token, inactive automation, wrong trigger
  type: all get the same 404, after a cheap shape check, with no timing-heavy
  work before the lookup.
- **A second runner.** Scheduled and webhook runs go through
  `AutomationsService.triggerExecution` like every other run; no parallel
  path that skips the execution row or the owner.
- **Double runs.** A schedule tick starts at most one run; a sender retrying
  with the same idempotency key starts at most one run.

## Webhooks

### Address (decided)

- Each WEBHOOK automation has a secret token: 32 random bytes, base64url
  (43 characters), generated with `crypto.randomBytes`. It replaces the
  guessable slug and is stored in the existing unique `webhookSlug` column
  (my call: no rename; the column already has a unique index).
- The full URL is `https://api.<host>/api/v1/automations/webhook/<token>`
  (the API's public URL from config). It is shown in the studio's webhook
  trigger inspector with a Copy button, any time (my call: persistent display,
  like Slack/Zapier/Make incoming webhooks, because senders get configured
  later; hashing it would force regenerate-to-see).
- **Regenerate**: `POST /automations/:id/webhook/regenerate`
  (`automation:update`) issues a new token; the old URL stops working at once.
  Audited by the global interceptor. The studio asks for confirmation.
- A token is created when the trigger type becomes WEBHOOK (create or
  update), as today, but with the new format. Existing old-format slugs are
  replaced on the next save (production has no webhook automations).

### Request handling (decided)

`POST /api/v1/automations/webhook/:token`, public:

1. Reject anything whose token doesn't match `^[A-Za-z0-9_-]{43}$` with 404
   before touching the database.
2. Look the workflow up with `tenantContext.runAsSystem` (bypasses RLS for
   this one read). Not found, not ACTIVE, or `triggerType !== 'WEBHOOK'` →
   404 `Not found` (same body every time).
3. If the automation requires a signature (below) and it's missing or wrong →
   401.
4. Rate limit: **60 requests per minute per token** (my call), on top of the
   existing global per-IP throttling. Over the limit → 429.
5. Body: accept `application/json` and `application/x-www-form-urlencoded`
   (a plain `<form method="post">`); max **100 KB** (my call). Anything else
   → 415. Form fields arrive as strings.
6. Optional `Idempotency-Key` request header (max 200 chars): the same key for
   the same automation within **24 hours** returns the first run instead of
   starting another (my call: partner systems and Zapier retry). Builder may
   reuse `ChannelIdempotencyService` or the execution table.
7. Start the run with `triggerExecution` (owner = `activatedByUserId`, as
   Task 2 of the previous round already does for webhook runs), inside
   `runWithTenant(workflow.tenantId)`.
8. Respond **202** `{ "accepted": true }` for JSON requests. For form posts:
   if the automation has a configured "after submit" redirect URL, respond
   **303** to it; otherwise 202 with a short plain-text "Thanks, received."
   page (my call: a person submitting a form shouldn't see JSON).

`$trigger` for a webhook run: `{ payload: <parsed body>, receivedAt: <ISO>,
contentType: 'json' | 'form' }`. No request headers are exposed (my call:
avoids leaking the sender's auth headers into step configs and AI prompts).

### CORS (decided)

The webhook route answers cross-origin `POST` and preflight `OPTIONS` from
any origin, without credentials, so a site's own JavaScript can `fetch()` it.
Every other API route keeps today's `WEB_ORIGIN`-only CORS. Builder chooses
the mechanism (route-level headers or a scoped CORS handler).

### Optional signature (decided)

- Per automation, off by default: "Require a signature". When turned on, a
  secret is generated (32 random bytes, base64url) and shown in the studio
  with Copy and Regenerate.
- Senders compute `HMAC-SHA256(secret, rawBody)` and send it hex-encoded in
  header `X-Kerf-Signature: sha256=<hex>`. Compared with
  `crypto.timingSafeEqual`. Requires access to the raw body (Nest `rawBody`).
- Stored in `triggerConfig` as `signatureSecret` — never returned to anyone
  without `automation:update`, and never interpolated into steps.

### Form redirect (decided)

Optional `triggerConfig.redirectUrl` on webhook automations, `https://` only,
validated on save. Not taken from the request (no open redirect).

### Studio (decided)

Webhook trigger inspector shows: the URL (copy), Regenerate, "Require a
signature" toggle with secret (copy, regenerate), "After a form submits, send
people to" URL, and a short example (`curl` and an HTML `<form>` snippet).
Shows "Switch the automation on to start receiving" while not ACTIVE.

## Schedules

### What a tenant picks (decided)

No raw cron. A schedule is one of:

| Frequency | Fields |
|---|---|
| Every hour | minute past the hour (0-59) |
| Every day | time (HH:MM) |
| Every week | one or more days of the week, time |
| Every month | day of month (1-28), time |

Plus a **time zone**, default `Asia/Dubai` (my call: there is no organisation
time zone today; the product is UAE-first). Days 29-31 are excluded so every
month runs. Stored in `triggerConfig.schedule` as
`{ frequency: 'hourly' | 'daily' | 'weekly' | 'monthly', minute?, time?, daysOfWeek?, dayOfMonth?, timezone }`,
validated on save (shared zod schema). The studio's schedule trigger
inspector edits it and shows a plain-English summary ("Every Monday at 09:00,
Gulf time") and the next three run times.

### How it runs (decided)

- **Temporal Schedules** (the SDK's `client.schedule` API; no cron in the
  API process). One schedule per automation, id `automation-schedule-<workflowId>`,
  calendar spec built from the fields above, with the chosen time zone.
- Overlap policy **SKIP** (a run still going when the next tick comes skips
  that tick); catch-up window **1 hour** (after an outage, a missed tick older
  than an hour is skipped, not replayed).
- The schedule's action starts a small workflow on `automations-queue` that
  calls one activity, which calls `AutomationsService.triggerExecution` for
  the automation with `$trigger = { scheduledAt: <ISO>, timezone }`. One tick
  → at most one run: the run is keyed by the scheduled time (builder chooses:
  a deterministic Temporal workflow id per tick, or an idempotency key).
  The activity re-checks that the automation is still ACTIVE and still a
  SCHEDULE trigger before starting a run.
- Lifecycle, all in `AutomationsService`:
  - becomes ACTIVE with a SCHEDULE trigger → create (or update) the schedule;
  - schedule fields change while ACTIVE → update it;
  - PAUSED or DRAFT → delete the schedule (my call: delete, not pause — one
    source of truth, recreated on activation);
  - trigger type changes away from SCHEDULE, or the automation is deleted →
    delete it.
  Temporal errors while doing so fail the save with a clear message (the
  automation stays in its previous state).
- **Self-healing on boot** (my call): when the API starts, it lists ACTIVE
  SCHEDULE automations (system context) and ensures each has a matching
  Temporal schedule, and deletes `automation-schedule-*` schedules whose
  automation is gone or inactive. Covers a Temporal volume reset or a failed
  delete.
- Owner: `activatedByUserId`, as for CRM-event and webhook runs.

## Decisions from the builder check (my calls)

1. **Lapsed subscriptions pause these runs.** Webhook and schedule runs are
   the first triggers that act with nobody signed in, and `BillingGuard` lets
   `@Public()` routes through. So: the webhook handler checks
   `BillingService.restrictionFor(tenantId)` after the lookup and, when the
   organisation is restricted, returns the same 404 and starts nothing; the
   schedule tick activity checks the same and starts no run. Schedules stay in
   Temporal (no billing hooks), so runs resume by themselves once the
   subscription is paid.
2. **Weekly takes a set of days.** `dayOfWeek` becomes `daysOfWeek: number[]`
   (1-7 entries, Monday = 1), so "weekdays at 09:00" is one schedule. The
   summary reads "Weekdays at 09:00" / "Every Mon, Wed at 09:00". The old
   studio stored a raw cron on the trigger node (`config.cron`); that is
   dropped. An automation with a SCHEDULE trigger and no valid
   `triggerConfig.schedule` can't be activated (`Choose when this automation
   runs`), and boot reconciliation skips it with a warning. Production has no
   automations, so no data migration.
3. **A run that can't start is not "accepted".** Webhook and schedule runs
   use the same failure behaviour as CRM-event runs: if Temporal refuses the
   start, the webhook answers **503** (the sender's retry finishes it; an
   `Idempotency-Key` retry resumes the same execution row) and the tick
   activity throws so Temporal retries the tick. This means
   `triggerExecution` gets an option to rethrow on start failure, or these
   paths go through the `triggerForEvent` route with a per-request /
   per-tick key.
4. **The webhook URL is a credential.** `webhookSlug` and
   `triggerConfig.signatureSecret` are returned only to users with
   `automation:update`, on both `GET /automations/:id` and `GET /automations`
   (list). Read-only users see "Hidden — ask someone who can edit this
   automation".
5. **AI agent steps act as the owner when nobody triggered the run.** In
   webhook and schedule runs there is no triggering user, so today the agent
   step would get no tools. It now uses `ownerUserId` when there is no
   `actorUserId` (CRM-event runs keep today's behaviour; that broader change
   stays out of scope). The workflow input no longer reads
   `triggerPayload.event?.actorUserId` for webhook runs at all — the
   `$trigger = { payload, … }` wrapping keeps a webhook body from choosing the
   actor.

## Data / migrations

- No new tables. `triggerConfig` (jsonb) gains `schedule`,
  `signatureSecret`, `redirectUrl`. `webhookSlug` keeps its column.
- Shared types/schemas: the schedule shape and its zod schema; the webhook
  trigger config shape. Studio and API both use them.

## API responses

`GET /automations/:id` must not return `signatureSecret` to users without
`automation:update`; with it, it may (the studio needs to show it). Builder
picks the mechanism (strip in the controller for read-only users).

## Testing

- Webhook: token shape 404 without a DB query; unknown/inactive/wrong-type
  → identical 404; ACTIVE → 202 and a run as the owner with the payload in
  `$trigger.payload`; form-encoded body → payload of strings, 303 when a
  redirect is set; 415 for other content types; >100 KB → 413; signature
  required → 401 when missing/wrong, 202 when right; idempotency key → one
  run for two identical requests; rate limit → 429 on the 61st request in a
  minute; regenerate → old token 404, new one works; CORS preflight allowed on
  this route only.
- Schedule: zod schema accepts the four shapes and rejects day 29+, minute 60,
  bad time zone; schedule spec built correctly for each frequency and time
  zone; lifecycle create/update/delete on activate/edit/pause/delete/type
  change (Temporal client mocked); boot reconciliation creates missing and
  deletes orphaned schedules; a tick for an automation that became inactive
  starts no run; one tick → one run.
- Live on switeaz.com after deploy: an hourly schedule produces a run within
  the hour; a curl POST and an HTML form POST to a webhook each produce a run.

## Left to the builder

- Idempotency storage for `Idempotency-Key` and per-tick dedupe.
- CORS mechanism for the single route.
- Exact studio layout and copy beyond what's quoted.
- How the scheduled-tick workflow/activity get `AutomationsService` in the
  worker (it is reachable through `QuotesModule`'s import of
  `AutomationsModule`; a direct import into the worker module is fine).
