---
name: Lib typecheck staleness
description: Why api-server typecheck can report phantom missing columns after a lib/db schema change
---

After changing a `lib/*` package (e.g. adding a column to `lib/db/src/schema/*.ts`), running only
`pnpm --filter @workspace/api-server run typecheck` can fail with errors like "Property 'X' does not
exist on type ..." even though the schema clearly has it.

**Why:** leaf artifacts typecheck against the *compiled* `.d.ts` of the composite lib, which is cached
(`.tsbuildinfo`). The per-package typecheck does not rebuild libs, so it sees the old declarations.

**How to apply:** after any `lib/*` change, run `pnpm run typecheck:libs` (or the full `pnpm run typecheck`,
which builds libs first) before trusting an artifact's `--filter` typecheck result.
