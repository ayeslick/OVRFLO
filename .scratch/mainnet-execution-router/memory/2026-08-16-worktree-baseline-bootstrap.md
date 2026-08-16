A new git worktree is not a ready checkout. `git worktree add` copies tracked files
only. These are gitignored and will be missing until loaded:

- `web/node_modules/` (and repo-root `node_modules/`)
- `web/.env.local` (and other `.env*` except `.env.example`)
- Foundry `out/` and `cache/`
- `web/.next/`

Missing deps, missing env, or empty `out/` is **bootstrap**, not a failed baseline.
Do not stop and do not invent a new baseline because `vitest` is absent or
`NEXT_PUBLIC_*` threw at import.

Load, then run, in the ticket worktree (`cd $WORKTREE` first; echo pwd/toplevel/branch/HEAD):

1. Web modules: if `$WORKTREE/web/node_modules/.bin/vitest` is missing, symlink the
   campaign tree if it already has them
   (`ln -sfn /Users/jay/OVRFLO/web/node_modules $WORKTREE/web/node_modules`);
   otherwise `npm ci` in `$WORKTREE/web` (lockfile is `web/package-lock.json`).
   Do not `npx vitest` from another tree.
2. Env: if `$WORKTREE/web/.env.local` is missing and
   `/Users/jay/OVRFLO/web/.env.local` exists, copy it. Do not print values.
3. Forge: `out/` is empty in a new worktree. `forge build` then `forge test` is the
   baseline, not a compile failure. Need RPC? Source from the copied env without
   echoing the URL.
4. `npm test` / `pretest` / `typegen` may need that `forge build` first (wagmi foundry
   plugin reads `out/`).

Only after those exist is a red suite a real baseline failure. Then stop and report
totals; do not invent a baseline. Never commit `node_modules`, `foundry.lock`, or env.
