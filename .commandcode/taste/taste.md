# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- Validate web changes by running `pnpm lint && pnpm typecheck && pnpm build` in apps/web before reporting completion. Confidence: 0.70

# architecture
- Project is a pnpm monorepo with `apps/*` workspace; run dev servers via `pnpm --parallel --filter "./apps/*" dev` (web on :3000, API on :4000). Confidence: 0.70
- Seeded demo accounts follow the convention `{role}@northwind.test` (owner, admin, manager, rep, viewer) all with password `Password123!`. Confidence: 0.75
