# Running the test suite

How to run every test tier in this repo without tripping over the environment gotchas that have actually bitten agents before. Read this before running tests, not after a confusing failure.

There are three independent tiers. They don't share setup — running one doesn't imply the others are ready.

| Tier | What | Needs |
|---|---|---|
| Solidity | `forge build` / `forge test` | Nothing extra for unit/fuzz/invariant. `MAINNET_RPC_URL` for `test/fork/*` (self-skips without it). |
| Frontend unit | Vitest, `web/lib` + `web/hooks` | Nothing extra. |
| E2E | Playwright + Gherkin, `web/tests/e2e` | A seeded local Anvil fork + Ponder + dev server. `MAINNET_RPC_URL` (a paid archive RPC — Alchemy/QuickNode/paid Infura; the free tier will not work for this). |

## Solidity

```bash
forge build
forge test
```

Useful narrower invocations:

```bash
forge test --match-test test_FunctionName
forge test -vvv                                              # verbose, for debugging a failure
FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv   # invariant tests, 500 runs/depth 40
forge test --match-contract OVRFLOFuzz                        # fuzz tests (1000 runs)
forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL
```

Without `FOUNDRY_PROFILE=invariant`, `--match-contract OVRFLOLendingInvariant` still runs, but under the default profile's much lighter `[invariant]` settings (`foundry.toml`: `runs = 25, depth = 10`), not the `500`/`40` the invariant profile actually configures — it will not fail, it will just quietly cover far less ground. Always set the env var for a real invariant run.

`test/fork/*` tests call `vm.skip(bytes(rpc).length == 0)` after reading `MAINNET_RPC_URL` via `vm.envOr` (see `test/fork/OVRFLOForkBase.t.sol:18-19`) — **they silently skip, not fail, when the env var is unset.** A clean `forge test` run with 0 fork-test failures does not mean the fork tests passed; check the skip count in the output, and only trust fork-test results from a run where `MAINNET_RPC_URL` was actually exported.

Do **not** run `forge script script/OVRFLO.s.sol --broadcast` against a local Anvil fork — it hits a known Foundry bug ([foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714)) and fails with `lack of funds (0) for max fee` even when the broadcaster is funded. Use `bash script/seed-local.sh` (or the `bootstrap:*` wrappers below) for local deployment instead — see `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`.

## Frontend unit tests (Vitest)

```bash
npm --prefix web run test              # single run
npm --prefix web run test:watch        # watch mode
npm --prefix web run test -- --coverage   # informational only — no CI gate, no per-file threshold (see web/vitest.config.ts)
```

No environment setup needed — these are pure unit tests over `web/lib/**` and `web/hooks/**` with everything else mocked.

## E2E tests (Playwright + Gherkin)

These are the tier that actually needs a live environment, and the tier where agents have gotten stuck before. Read this whole section before running `test:e2e`.

### One-shot setup (use this, not the manual steps)

```bash
export MAINNET_RPC_URL=...     # a paid archive RPC — required
npm --prefix web run bootstrap:e2e
```

This runs `tools/scripts/bootstrap-e2e.sh`, which:
1. Tears down any existing local environment unconditionally (`bootstrap-clean.sh local`) — you do not need to check whether something is already running first, and you should not try to reuse a possibly-stale environment from an earlier session.
2. Brings up Anvil (forked at the live mainnet head — no block pin) + `script/seed-local.sh` (deploys OVRFLO, discovers live Pendle markets, seeds test data) + Ponder, via the existing `bootstrap:local` script.
3. Starts the Next.js dev server backgrounded with `NEXT_PUBLIC_E2E=1` (swaps in a mock wagmi connector so E2E can sign transactions without a real wallet-connect flow), and polls `http://localhost:3000` until it's ready (up to 30s) before proceeding.
4. Regenerates the Playwright spec files (`bddgen`) from the current `.feature` files.

It prints readiness at the end:
```
=== e2e testbed ready ===
app        : http://localhost:3000
rpc        : http://127.0.0.1:8545
ponder sql : http://localhost:42069/sql
```

Then run the suite:

```bash
npm --prefix web run test:e2e          # headless
npm --prefix web run test:e2e:ui       # Playwright UI mode (local debugging only, not for an agent)
```

**Tear down when you're done — but only if you're the one who brought the environment up, and nothing else is still using it.** There is exactly one shared Anvil fork/Ponder instance/dev server for the whole repo (see the concurrency warning below); tearing it down out from under another running test invocation, a human developer poking at `localhost:3000`, or another agent's in-progress session kills their work, not just yours. Before cleaning up:

- If you started this environment yourself in this session (ran `bootstrap:e2e`/`bootstrap:local` yourself) and nothing else has touched it since, it's yours to tear down.
- If you attached to an environment you didn't start (it was already up when you began), leave it running — don't clean up state you don't own.
- If unsure whether anything else is using it, check for other activity before tearing down rather than assuming it's idle — e.g. whether the dev server log (`.bootstrap.web.log`) has recent request activity, or simply ask rather than guessing.

```bash
npm --prefix web run bootstrap:local:clean
```

### Watching progress live (for an agent running this in the background)

`web/playwright.config.ts:22` sets `reporter: "list"`, so the suite prints a `✓`/`✘` line per scenario as it finishes, not just a final summary — that's the signal to key off of for live progress. A full run is currently ~31 scenarios and takes several minutes, so don't just fire the command and go silent until it exits.

Run the suite backgrounded to a log file, then stream just the result lines rather than the full (noisy) output:

```bash
npm --prefix web run test:e2e > /tmp/e2e-run.log 2>&1 &
E2E_PID=$!
```

then watch it (e.g. via the Monitor tool, or `tail -f` in a terminal) with a filter that only matches per-scenario results, not every line:

```bash
tail -f --pid=$E2E_PID /tmp/e2e-run.log | grep -E --line-buffered '✓|✘|passed|failed'
```

This gives one notification per scenario as it completes and ends naturally when the run exits — no polling needed, and no waiting blind for ~10 minutes to find out something failed at scenario 3. If fewer, coarser updates are preferable to one-per-scenario, check in on the log a couple of times over the run instead (`tail -n 20 /tmp/e2e-run.log`) rather than streaming every result.

Don't stream the raw unfiltered log — Playwright's `list` reporter also prints per-step detail and, on failure, full stack traces/call logs, which floods a live watch with noise unrelated to overall progress.

### Don't do this instead

The manual multi-step path (`BOOT_NO_UI=1 npm --prefix web run bootstrap:local`, then separately `NEXT_PUBLIC_E2E=1 npm --prefix web run dev` in another process, then `test:e2e`) still works and is what `bootstrap:e2e` composes under the hood — but doing it by hand, especially across repeated runs in one session, is exactly what caused real environment corruption before this script existed: orphaned Ponder/Next.js processes from an incompletely torn-down prior run, a stale `deployments/local.json` pointing at a factory address from a fork that no longer exists, and colliding `evm_snapshot`/`evm_revert` calls if two processes touch the same Anvil instance at once. Use `bootstrap:e2e`.

**Never run two bootstrap/test invocations concurrently against the same local environment** (e.g. from two parallel agent tasks). There is exactly one shared Anvil fork, one Ponder instance, and one dev server; a second process tearing it down or reseeding mid-run from under the first looks *exactly* like a mass test-suite regression (most or all scenarios failing at once) but is actually a self-inflicted collision. If you need to run something else that touches this environment while tests are in flight, don't — wait, or coordinate so only one process owns the environment at a time.

### Before concluding a failure is real

If you see a **mass cascade of failures** (most/all scenarios failing, not one or two) or a **connection-refused-shaped error**, check environment health before treating it as a regression:

```bash
cast block-number --rpc-url http://127.0.0.1:8545          # is Anvil even up?
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000   # dev server responding? (200 expected)
curl -s http://localhost:42069/status                        # Ponder status
```

Specific known-shapes that are environment issues, not code bugs:

- **Ponder shows `backfill` instead of `live`, or the app shows "UNABLE TO LOAD POSITIONS" / no stream data.** Check `curl -s http://localhost:42069/status` — if it's still backfilling, wait; don't treat missing Sablier/lending data as a frontend bug until Ponder reports `live`. (Historically this was actually a bug — a hardcoded stale `startBlock` — but that's fixed; if you see backfill lasting more than a few seconds after a fresh `bootstrap:e2e`, something regressed, see `docs/solutions/integration-issues/ponder-hardcoded-start-block-drifts-from-live-fork-head.md`.)
- **A form's submit button stays permanently disabled until the test times out**, with near-zero RPC traffic during the stall. This is very likely a nonce collision between a fixture-direct write and an in-flight UI-driven transaction from the same account, not an app bug — see `docs/solutions/test-failures/supply-e2e-drain-fixture-nonce-collision-with-approve-tx.md` for the mechanism and the fix pattern (wait for an app-observable confirmation signal, not just nonce parity).
- **A `getByRole` locator ambiguously matches more than one element**, or a click lands on the wrong (possibly disabled) element. Check whether two different components can render a button with the same literal accessible name at the same time — see `docs/solutions/ui-bugs/stream-card-borrow-button-accessible-name-collides-with-market-row-borrow.md` for a worked example. Don't just add `.first()` and move on; that silences the ambiguity without resolving it.
- **A step that "should" be a no-op (e.g. re-expanding an already-expanded row) actually changes state.** Some shared step definitions are plain toggles, not idempotent "ensure" actions — check the step's implementation before assuming a later assertion's failure is unrelated. See `docs/solutions/test-failures/expand-active-market-step-toggle-not-idempotent-collapses-position-list.md`.
- **A scenario's action button never becomes clickable even though you clicked the approval button.** Some flows need more than one ERC-20 approval (e.g. deposit needs both a PT approval and a separate underlying-token fee approval) — check `web/components/ActionModal.tsx`'s `needsPtApproval`/`needsUnderlyingApproval` gating before assuming one approval is enough. See `docs/solutions/test-failures/deposit-e2e-scenario-missing-underlying-fee-approval-step.md`.

If none of the above match and the environment checks come back healthy (Anvil responsive, dev server 200, Ponder `live`), it's plausibly a real regression — proceed to debug the actual scenario.

### Other things worth knowing

- **`workers: 1` is intentional**, not a performance oversight — every scenario mutates the one shared seeded fork's real chain state, and per-scenario `evm_snapshot`/`evm_revert` isolation hasn't been validated as parallel-safe yet. Don't try to parallelize E2E runs.
- **Markets are discovered live, not hardcoded** — `seed-local.sh` queries Pendle's live markets API each run rather than using a fixed address, so which specific market ends up seeded varies run to run. Nothing in the suite should be written to depend on a specific market address staying valid.
- There is no CI wiring for `test:e2e` yet — it's a local/agent developer command only.
- Full details, fixture architecture, and the synchronization rules for fixture-direct writes are in `web/tests/e2e/README.md` — read it if you're adding new scenarios or steps, not just running the existing suite.

## Quick reference

```bash
# Solidity
forge build && forge test

# Frontend unit
npm --prefix web run test

# E2E (needs MAINNET_RPC_URL exported first)
export MAINNET_RPC_URL=...
npm --prefix web run bootstrap:e2e
npm --prefix web run test:e2e
npm --prefix web run bootstrap:local:clean   # teardown when done
```
