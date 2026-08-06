# 12 — Fix local bootstrap so Ponder actually indexes lending events

**What to build:** Fix a bug found in code review: on the local Anvil fork, the demand pipeline (R20–R22, ticket 09) never actually indexes anything, despite tickets 09/10 recording a passing live e2e demand run.

`tools/scripts/bootstrap-local.sh:88` launches `npm --prefix web run ponder:dev` with only `PONDER_RPC_URL` set in its environment. `tools/scripts/write-env.sh local` — which would supply the factory address as `NEXT_PUBLIC_OVRFLO_FACTORY` — doesn't run until line 107, *after* Ponder's process has already started, and it only writes `web/.env.local`, a file the already-running Ponder process never re-reads (env vars are captured once at process start). `tools/ponder/ponder.config.ts:10` falls back to the zero address when neither `PONDER_OVRFLO_FACTORY` nor `NEXT_PUBLIC_OVRFLO_FACTORY` is set, which by its own comment "indexes nothing."

Fix the ordering so the factory address (available in `deployments/local.json` after seeding) is exported into Ponder's actual process environment before or at the moment `ponder:dev` launches — per KTD9's original requirement that `PONDER_FACTORY_ADDRESS`-equivalent be exported "on the same line that launches `ponder:dev`."

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Running `npm --prefix web run bootstrap:local` end-to-end results in Ponder's lending-events indexing actually active (not silently defaulted to the zero address)
- [x] A real borrow performed on the local fork after bootstrap appears in the demand column within one refetch — actually re-verified live, not just asserted
- [x] The fix reads the factory address from the same source `write-env.sh` already uses (`deployments/local.json` or equivalent) so there's one source of truth, not a second hardcoded copy
- [x] Ordering is correct for a fresh bootstrap from a clean state (no stale `.env.local` masking the bug on a re-run)
- [x] A brief startup log line (per KTD9's "startup health check") confirms the factory entry resolved and found at least one `LendingDeployed` event, so this failure mode is visible immediately on future bootstraps rather than silently producing "NO DEMAND DATA" everywhere

## Comments

**2026-07-27 — resolved.**

`tools/scripts/bootstrap-local.sh`: read `deployments/local.json`'s `.factory` (same source `write-env.sh` uses) into `LOCAL_FACTORY` and export it as `PONDER_OVRFLO_FACTORY` on the same line that launches `ponder:dev`, before the readiness wait. Added a startup health check right after Ponder reports ready: `cast logs "LendingDeployed(address,address)" --address "$LOCAL_FACTORY" --from-block "$FORK_BLOCK"` counts real on-chain `LendingDeployed` events and logs a confirming line, or a `WARNING` to stderr if zero (the `--from-block` bound matters — an unbounded `cast logs` call hit the upstream free-tier RPC's 10-block `eth_getLogs` range limit through Anvil's fork passthrough).

Verified end-to-end from a clean state (no prior `.env.local`/`deployments/local.json`) three times:
1. First run (before the health-check bound fix) confirmed the core fix: Ponder's `OVRFLOLending:BorrowerLoanPoolCreated` count went from 0 to 1 within one poll after running the existing `tools/scripts/walkthrough-local.sh` two-wallet script to create a real borrow — proving Ponder was watching the correct (non-zero) factory-derived lending address, not silently defaulted.
2. Second run caught the `cast logs` unbounded-range RPC error (script aborted mid-run via `set -e`; cleaned up the orphaned anvil/ponder processes it left behind).
3. Third run (current code) passed clean end-to-end: `health check: factory 0x... emitted 1 LendingDeployed event(s) — Ponder should index it`, then bootstrap completed and tore down cleanly via `bootstrap:local:clean`.

`npm --prefix web run test` — 152/152 passing (no test changes needed; only shell script touched). `forge build`/`forge test` not run — no Solidity changed.

Filed a separate follow-up (not blocking this ticket): `bootstrap:local:clean` kills the `npm run ponder:dev` wrapper PID but not the `ponder dev` child process it spawns, leaking a background process across bootstrap/clean cycles — observed directly during verification, unrelated to this ticket's factory-export-order bug.
