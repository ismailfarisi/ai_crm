# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- Validate web changes by running `pnpm lint && pnpm typecheck && pnpm build` in apps/web before reporting completion. Confidence: 0.70
- Before committing, verify the feature is fully built: run build, lint, unit tests, and e2e tests (bringing up required infra like Docker/Postgres if needed) and only commit when everything passes. Confidence: 0.80

# architecture
- Project is a pnpm monorepo with `apps/*` workspace; run dev servers via `pnpm --parallel --filter "./apps/*" dev` (web on :3000, API on :4000). Confidence: 0.70
- Seeded demo accounts follow the convention `{role}@northwind.test` (owner, admin, manager, rep, viewer) all with password `Password123!`. Confidence: 0.75
- Customers are modeled as companies, not individuals: the Customer entity is tenant-scoped with `companyName` as the natural key (unique per organization) plus a company profile (contact name/email/phone, billing address, taxId, currency, payment terms, notes). Invoices are expected to hang off customers later. Confidence: 0.7

# communication
- Writes terse, informal, lowercase messages with minimal punctuation (e.g. "yes create a customer mostly they are companies") and expects the agent to infer scope, plan, and proceed; a short affirmative is approval to build. Confidence: 0.7
