# Relay CRM

A multi-tenant SaaS CRM with permission-level RBAC.

- **`apps/api`** — NestJS 11, TypeORM 1, PostgreSQL 18
- **`apps/web`** — Next.js 16 (App Router), React 19, Tailwind 4
- **`packages/shared`** — the permission catalog, zod schemas and API types both apps compile against

## Quick start

```bash
pnpm install
cp .env.example .env                    # docker compose
cp apps/api/.env.example apps/api/.env  # the API
cp apps/web/.env.example apps/web/.env.local

pnpm db:up      # postgres + redis in docker
pnpm dev        # api on :4000, web on :3000
```

Then seed a demo organization with five users across the role hierarchy:

```bash
pnpm seed
```

| Account                  | Role    | What they can see and do                              |
| ------------------------ | ------- | ----------------------------------------------------- |
| `owner@northwind.test`   | Owner   | Everything, including billing. Not editable.          |
| `admin@northwind.test`   | Admin   | Team, roles, and every contact. No billing.           |
| `manager@northwind.test` | Manager | Every contact, but no team or role administration.    |
| `rep@northwind.test`     | Member  | Only contacts assigned to them. Cannot delete.        |
| `viewer@northwind.test`  | Viewer  | Read-only, own contacts only.                         |

All five use the password `Password123!`.

Open <http://localhost:3000>. API docs are at <http://localhost:4000/api/v1/docs>.

## How the RBAC works

The model is **roles → permissions**, with permissions as the thing code checks.

1. **`packages/shared/src/rbac/permissions.ts` is the single source of truth.** Every permission is a `subject:action` string defined there. The API syncs the catalog into the `permissions` table on boot, and the web app imports the same constants — a typo is a compile error, not a silent 403.

2. **Roles are per-organization.** Each tenant gets its own copy of the five system roles at signup, so one customer retuning `member` never touches another's. Custom roles sit below every system role.

3. **Permissions are resolved per request, not read from the token.** The JWT carries only identity. `RbacService.resolveAccess` unions the permissions across the user's roles on each request behind a 5-second cache, so revoking a role takes effect almost immediately instead of when the access token expires.

4. **Two guards, applied globally.** `JwtAuthGuard` authenticates (routes opt out with `@Public()`), then `PermissionsGuard` authorizes against `@RequirePermissions(...)`.

```ts
@Post()
@RequirePermissions(PERMISSIONS.CONTACT_CREATE)
create(@CurrentUser() user: AuthenticatedUser, @Body(zodBody(createContactSchema)) input) { … }
```

5. **Ownership is a second axis.** `contact:read` shows a user only the contacts assigned to them; `contact:read_all` widens it to the whole organization. `ContactsService.scoped()` applies the tenant filter and then the ownership filter to every single query, so it cannot be forgotten at a call site.

6. **Escalation is blocked in both directions.** You cannot grant a permission you do not hold yourself, and you cannot assign, edit or delete a role at or above your own level. The owner role is a wildcard grant (`grantsAllPermissions`) rather than an enumerated list, so permissions added in a later release are picked up automatically.

The UI mirrors all of this with `<Can permission={…}>`, but that is presentation only — every rule above is enforced server-side on every request.

## Auth

Access and refresh tokens are delivered as `httpOnly` cookies, so no token ever touches JavaScript.

- Access token: 15 minutes. Refresh token: 7 days, stored **hashed**, and rotated on every use.
- Reusing an already-rotated refresh token is treated as theft: the entire token family is revoked.
- Changing a password or deactivating an account bumps `credentialsChangedAt`, which invalidates every access token issued before that instant — logout-everywhere without a blocklist.
- The browser client coalesces concurrent 401s into a single refresh, so parallel requests do not rotate the token N times and trip the reuse detector.

## Commands

| Command                   | What it does                                     |
| ------------------------- | ------------------------------------------------ |
| `pnpm dev`                | Run both apps                                    |
| `pnpm build`              | Build shared → api → web                         |
| `pnpm db:up` / `db:down`  | Start / stop Postgres and Redis                  |
| `pnpm db:reset`           | Drop the volumes and start fresh                 |
| `pnpm seed`               | Seed the demo organization                       |
| `pnpm migration:generate` | Diff entities against the database               |
| `pnpm migration:run`      | Apply pending migrations                         |

## Before production

- `DB_SYNCHRONIZE=true` is a development convenience. Generate a real migration (`pnpm migration:generate src/database/migrations/Init`) and set it to `false`. The API force-disables it whenever `NODE_ENV=production`, but do not rely on that.
- Replace both JWT secrets with real random values (`openssl rand -base64 48`).
- Set `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none` plus `COOKIE_DOMAIN` if the API and web app are on different subdomains.
- Point `API_INTERNAL_URL` at the API's private address so server components skip the public internet.
- Invites currently set a password directly. Swap in an email-based invite token before real users exist.
