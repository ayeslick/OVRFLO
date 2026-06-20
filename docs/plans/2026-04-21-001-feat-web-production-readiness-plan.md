---
title: "feat: OVRFLO Web Production Readiness — Local Loop, Devnet, Hardening"
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/web-production-readiness-requirements.md
---

# feat: OVRFLO Web Production Readiness — Local Loop, Devnet, Hardening

## Overview

Build the developer loop that lets a contributor go from `git clone` to a working
local DeFi UI (mainnet-forked anvil + deployed factory + seeded wallet + local
Sablier indexer + Next.js dev server) in one command, add the equivalent
Tenderly Virtual Testnet flow, and run the UI through a single hardening pass
(transaction preflight, error taxonomy, outage-tolerance, CSP relocation,
static-export verification, a11y sweep).

The underlying Solidity, product shape, and protocol integrations are already
complete and covered by fork tests. This plan is pure infrastructure + UI
hardening — no contract changes beyond mechanical refactor of test fixtures
into a shared location.

## Problem Frame

OVRFLO's contracts and UI both work against mainnet today, but there is no
way to *exercise* the UI against real contracts on demand. A contributor
cannot spin up the full stack in one command; the devnet path has no
automation; and the UI has hardening gaps typical of a v0 (unwired CSP,
no transaction preflight, no indexer-outage handling, a11y unknown).

Per `docs/brainstorms/web-production-readiness-requirements.md` the decisions
driving the plan are:
- Devnet = Tenderly Virtual Testnet (not public testnet, not self-hosted fork).
- Local streams surface via a **local Envio indexer**, not log scanning.
  Log scanning is explicitly banned by
  `docs/solutions/patterns/ovrflo-critical-patterns.md` pattern #1.
- Scope = **hardening pass**, not launch (analytics, onboarding, Sentry,
  i18n are deferred).
- UI target = static export on a managed edge host (Vercel/Cloudflare/Netlify).

## Requirements Trace

Every numbered requirement below comes from the origin document. All
implementation units cite these IDs. See origin:
`docs/brainstorms/web-production-readiness-requirements.md`.

**Orchestration — Local Anvil**
- R1. One command stands up the full local stack.
- R2. Every step must also run standalone; composable scripts.
- R3. Anvil pins `--fork-block-number` to `MAINNET_FORK_BLOCK` (24_609_670).
- R4. Seed logic reuses constants + helpers from `OVRFLOForkBase`.
- R5. Bootstrap fails fast on missing prereqs.
- R6. One-command teardown wipes anvil state, Envio volume, `.env.local`.

**Orchestration — Tenderly Devnet**
- R7. Parallel `bootstrap:devnet` flow against Tenderly Virtual Testnet.
- R8. Devnet flow is idempotent with reuse-vs-redeploy flag.
- R9. Devnet uses the hosted Sablier Envio indexer.

**Local Sablier Indexer**
- R10. Local Envio indexer runs via docker-compose against local anvil RPC.
- R11. Sablier Envio config is vendored under `tools/envio/`.
- R12. UI reads indexer URL from `NEXT_PUBLIC_SABLIER_INDEXER_URL`.
- R13. Local indexer seeded from fork block forward; <30s catch-up.

**UI Hardening — Reliability**
- R14. App-router error boundaries verified + extended into modals.
- R15. Deposit/claim/withdraw run transaction preflight via wagmi
  `simulateContract`.
- R16. Envio + CoinGecko outages degrade gracefully with specific banners.
- R17. Wallet-connection failures render specific messages.
- R18. No `console.*` / `debugger` in client bundle; lint rule enforces.

**UI Hardening — Packaging & Security**
- R19. Verify clean static export + CI gate against non-static regressions.
- R20. Relocate CSP from `next.config.ts` to CDN surface
  (`vercel.json`, `public/_headers`) parameterized by env-configured origins.
- R21. Build-time check that no non-`NEXT_PUBLIC_` secret is referenced client-side.
- R22. `npm run lint` + `npm run test` pass clean.

**UI Hardening — Accessibility & Polish**
- R23. A11y sweep on dashboard + both modals + streams table.
- R24. External links have `rel="noopener noreferrer"`.
- R25. Long addresses/tx hashes ENS-resolved where possible, safely truncated.

**Success Criteria carried forward:** SC-1 through SC-6 from the origin
document. Each Implementation Unit's `Verification` field maps back to the
relevant SC.

## Scope Boundaries

Identical to origin document. In particular, **out of scope**:
- Playwright CI smoke tests, analytics, onboarding, i18n, Sentry, feature flags.
- Any chain other than mainnet (local/devnet/mainnet all run against mainnet
  or a mainnet fork).
- Re-introducing on-chain `Deposited` event scanning for Sablier discovery
  (forbidden by pattern #1).
- Public testnet deploys (Sepolia, Holesky) — OVRFLO hardcodes mainnet
  Pendle/Sablier addresses.
- Production-hosting the local Envio indexer (hosted URL backs devnet + mainnet).
- Solidity contract behavior changes in `src/*`. Extracting fixtures into
  `script/lib/` is mechanical refactor and must leave existing tests green.

### Deferred to Separate Tasks
- **Playwright smoke CI** — deferred per challenger option not selected; a
  follow-up plan if we move to launch-tier.
- **Sentry / error reporting pipeline** — launch tier.
- **Onboarding / first-use flow, i18n** — launch tier.

## Context & Research

### Relevant Code and Patterns

- `test/fork/OVRFLOForkBase.t.sol` — authoritative constants
  (`MAINNET_FORK_BLOCK`, `STETH`, `PRIMARY_MARKET`, `SECONDARY_MARKET`,
  `ORACLE`, expiry timestamps) and helpers (`_deployConfiguredSystem`,
  `_prepareOracle`, `_deployApprovedPrimarySeries`,
  `_seedBalancesAndApprovals`) that the seed scripts must reuse verbatim.
- `test/fork/OVRFLOMainnetFork.t.sol` — reference for the full deposit →
  stream → withdraw → claim flow on a mainnet fork; confirms `deal(PRIMARY_PT, USER, ptAmount)`
  works and that stETH is mintable by sending ETH to `0xae7a...7fE84` with
  `submit(address)`.
- `script/OVRFLO.s.sol` — existing deploy script; extend or complement with
  new `SeedLocal.s.sol` / `SeedDevnet.s.sol` rather than replace.
- `web/lib/sablier.ts` — current GraphQL client; queries `Stream` entity
  which does not exist in Sablier's actual Envio schema (see Key Decisions).
- `web/lib/config.ts` — `SABLIER_ENVIO_URL` is hardcoded (line 25-26);
  `parseChainId` hard-rejects anything other than mainnet id 1. Both are
  load-bearing for this plan.
- `web/lib/errors.ts` — `getErrorMessage` / `getReadContractsError` /
  `isFrontendConfigError`. Wallet-failure taxonomy extension lives here,
  per `docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md`
  ("Do not re-add `parseStreamError`").
- `web/app/error.tsx`, `web/app/global-error.tsx` — app-router boundaries
  already exist; work is verification + extension into modals.
- `web/next.config.ts` — `output: "export"` is already set; `securityHeaders`
  is defined but never referenced and `headers()` is a no-op under static
  export. This is effectively dead code today.
- `web/components/Dashboard.tsx`, `NewOvrfloModal.tsx`, `ClaimModal.tsx` —
  preflight entry points; USD prop-drill pattern must be preserved.

### Institutional Learnings

All four entries in `docs/solutions/` materially constrain this plan:

- `docs/solutions/patterns/ovrflo-critical-patterns.md` pattern #1 —
  **Banned: any log-scan or `Deposited` event fallback for stream
  discovery.** Acceptable Envio-down degradations are (a) empty state +
  retry UI, (b) per-`tokenId` `ownerOf` lookups against cached IDs, (c)
  secondary indexer. Unit 8 must respect this. A CI grep check
  (`rg "event Deposited|watchContractEvent|getLogs.*Deposited" web/lib`)
  is added in Unit 10 to keep it banned.
- `docs/solutions/integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md` —
  The local Envio indexer must answer the same GraphQL query shape as the
  hosted one. `web/tests/lib/sablier.test.ts` is a regression gate and
  must stay green after the `Stream` → `LockupStream` rename in Unit 5.
- `docs/solutions/ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md` —
  `useUsdPrices` pattern is `Dashboard` → prop-drill → modals. Hardening
  must not introduce a React Context, a second modal-level fetch, or gate
  transactions on `prices` being defined. `data-testid="usd-*"` sublines
  are coverage anchors; preserve through the a11y sweep (Unit 10).
- `docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md` —
  Forbids reintroducing `NEXT_PUBLIC_FACTORY_FROM_BLOCK`, `Deposited` event
  on `ovrfloAbi`, `nativeUsd`/ETH CoinGecko price, or `parseStreamError`.
  Env example header count is load-bearing. Unit 10 adds CI grep smoke
  checks for these banned patterns.

### External References

- **Sablier Envio indexer** — [`sablier-labs/indexers`](https://github.com/sablier-labs/indexers)
  (GPL-3.0) is the upstream source for the vendored config in Unit 3.
  Config: `envio/streams/config.yaml`. Schema source of truth:
  `schema/streams/stream.graphql.ts`. The authoritative entity is
  **`LockupStream`**, not `Stream`; this drives the rename in Unit 5.
- **Envio local stack** — [Running Locally](https://docs.envio.dev/docs/HyperIndex/running-locally)
  and [Local Anvil](https://docs.envio.dev/docs/HyperIndex/local-anvil).
  Default ports: Postgres 5433, Hasura 8080 (`/v1/graphql`), indexer 8081.
  Admin secret defaults to `testing`. `pnpm dev` hot-reloads handlers only;
  schema/config changes require `pnpm envio start -r` (forced re-index).
  HyperSync is unavailable on localhost — RPC-only sync is slower, so
  `start_block` should sit near the fork head, not at Sablier's mainnet
  deploy block.
- **Chain-id trap** — Forked anvil defaults to `chain_id = 31337` regardless
  of the forked chain. `web/lib/config.ts` hard-rejects anything other than
  mainnet id 1. Resolution: start anvil with `--chain-id 1` so the RPC, the
  indexer, and the UI all agree (Unit 2 / Unit 6).

### Related Issues / Prior Art
- Commit `407678e` — "Fix static export hydration" (referenced by D6).
- Dead-code cleanup commit series from 2026-04-21 ( `docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md`).

## Key Technical Decisions

- **Reuse fork-test fixtures via extraction, not re-implementation.**
  Promote the constants and helpers from
  `test/fork/OVRFLOForkBase.t.sol` into `script/lib/OVRFLOTestFixtures.sol`
  (a non-`Test`-derived library-ish abstract contract). `OVRFLOForkBase`
  becomes a thin shim that inherits from it plus `forge-std/Test`; the
  new seed scripts inherit the fixture abstract directly. Zero behavioral
  change to existing tests. **Rationale:** pattern #1 in origin doc + user
  instruction not to re-roll proven logic.

- **Vendor `sablier-labs/indexers` at a pinned commit under `tools/envio/`.**
  Not a git submodule, not a runtime clone. Copy the `envio/streams/`
  subtree + supporting schema/ABI files + a small `NOTICE.md` citing the
  upstream repo + SHA. This isolates the planet from upstream churn and
  makes the local flow hermetic after initial install. **Rationale:** R11
  forbids runtime network dependencies in the local flow; cost of drift
  management accepted.

- **Rename `Stream` → `LockupStream` in the frontend GraphQL query.**
  Upstream schema exposes `LockupStream` (and `FlowStream`); the hosted
  endpoint we currently hit also exposes both — the fact that the current
  query works against it means Hasura has a `Stream` alias, which is *not*
  part of the vendored schema. Fixing the query to `LockupStream`
  works against both endpoints. **Rationale:** the hosted endpoint owns
  the alias; the vendored local indexer will not. Rewriting the query is
  lower-risk than vendoring + maintaining a Hasura view. Confirmed by
  web research; see `docs/brainstorms/web-production-readiness-requirements.md`
  "Deferred to Planning" item for R10/D5.

- **Run local anvil with `--chain-id 1`.** Both the Envio indexer and the
  UI filter by chainId; `web/lib/config.ts` hard-rejects anything other
  than mainnet. Forcing anvil onto chain 1 keeps a single value
  propagating through the stack without forking conditional logic.
  **Rationale:** simpler than threading `31337` through and re-loosening
  `parseChainId`.

- **Preflight simulates the write function directly, not preview functions.**
  `simulateContract({ functionName: "deposit" | "claim" | "withdrawMax" })`
  catches slippage, allowance, market-expired, and revert-on-settlement
  in one place. Preview functions (`previewDeposit`, `previewRate`, etc.)
  are still used for UX display but are not the preflight gate. **Rationale:**
  per origin doc deferred-question resolution; `simulateContract` exercises
  the entire code path including Sablier's fee pre-transfer and the
  oracle TWAP read.

- **Relocate CSP to two CDN surfaces:** primary `vercel.json` (Vercel is
  the stated target), secondary `public/_headers` for Cloudflare Pages /
  Netlify compatibility. Delete the unwired `securityHeaders` array from
  `next.config.ts`. **Rationale:** `headers()` is a no-op under
  `output: "export"`; keeping it there is strictly confusing.

- **`connect-src` is parameterized at build time from env-configured
  origins.** The CSP template treats `NEXT_PUBLIC_RPC_URL`,
  `NEXT_PUBLIC_SABLIER_INDEXER_URL`, `NEXT_PUBLIC_PRICE_API_URL` as
  substitution points for Unit 10's build step. A contributor deploying
  to a new environment updates env vars, runs build, gets a correct CSP
  for free. **Rationale:** avoids hardcoded origins rotting across
  environments.

- **Extend `lib/errors.ts#getErrorMessage` with a taxonomy classifier;
  do not add a new parser module.** New pure function
  `classifyUserError(error): { kind: "user-rejected" | "wrong-network" |
  "insufficient-balance" | "slippage" | "market-expired" | "indexer-down" |
  "rpc-down" | "unknown", message: string }` lives in `lib/errors.ts`.
  Consumers (`StatusPanel`, `NewOvrfloModal`, `ClaimModal`,
  `WrongNetworkBanner`, `NetworkGuard`) read `.kind` to pick tone and
  recovery UI. **Rationale:** `parseStreamError` is on the banned list;
  centralizing in `lib/errors.ts` honors the existing prevention rule
  from entry #4.

- **Tooling + hardening land in dependency order, but hardening
  PR-by-PR.** Implementation units are sequenced so Units 1–6 produce a
  working local loop before any hardening unit lands. Units 7–10 can
  land as independent PRs against the already-working local loop.
  **Rationale:** Approach 1 from origin doc, decomposed so hardening
  reviewers see the *real* UI against the *real* stack, not mocks.

## Open Questions

### Resolved During Planning

- **Where should shared fixtures live** — `script/lib/OVRFLOTestFixtures.sol`,
  with `OVRFLOForkBase.t.sol` becoming a `forge-std/Test`-mixing shim that
  inherits from it. Both `test/fork/*` and `script/*.s.sol` can import.
  No circular dependency because the fixtures abstract does not depend on
  `Test`.
- **Sablier Envio config availability** — Resolved: vendor
  `sablier-labs/indexers`'s `envio/streams/` tree under `tools/envio/`.
  Entity `LockupStream` drives a frontend query rename.
- **Envio bind address / ports** — Resolved: Postgres 5433, Hasura 8080,
  indexer 8081. GraphQL at `http://localhost:8080/v1/graphql`. Named
  volumes for Postgres so `envio:reset` wipes cleanly.
- **Which function does preflight simulate** — Resolved: the write
  function itself (`simulateContract` on `deposit`/`claim`/`withdrawMax`).
- **Next.js 16 + static export + Turbopack** — Resolved: `output: "export"`
  is already set and commit `407678e` verified hydration works. Unit 9's
  CI gate prevents future regressions.
- **CSP directive set** — Resolved: `default-src 'self'`, `frame-ancestors
  'none'`, `script-src 'self' 'unsafe-inline' <wallet origins>`,
  `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https:`,
  `font-src 'self' data:`, `connect-src 'self' ${RPC} ${INDEXER} ${PRICE_API}
  <walletconnect + reown relays, including wss>`, `frame-src
  <walletconnect/reown>`. `unsafe-inline` on script-src is retained only
  if audit in Unit 9 confirms Next.js 16 static output requires it —
  otherwise drop.
- **A11y tool** — Resolved: `@axe-core/cli` for the single-shot sweep in
  Unit 11; rerunnable via `npm run a11y`. No CI gate this pass (out of
  scope with Playwright).

### Deferred to Implementation

- Exact Postgres volume naming and cleanup semantics on
  `bootstrap:local:clean`. Settled during Unit 4.
- Whether to split `.env.example` into `.env.example.local` /
  `.env.example.devnet` / `.env.example.mainnet` or keep one file with
  profile-commented blocks. Settled during Unit 6; instinct is one file.
- Specific grep patterns for the banned-code CI smoke check. Settled
  during Unit 9; seed list is in the origin doc.
- Whether ENS resolution (R25) needs a fallback when the configured RPC
  doesn't support mainnet ENS (local anvil fork does, since it forks
  mainnet). Settled during Unit 11.
- Exact mapping of `simulateContract` error subclasses
  (`ContractFunctionExecutionError`, `ContractFunctionRevertedError`,
  `UserRejectedRequestError`) to taxonomy `kind`s. Settled during Unit 7.
- Whether Tenderly Virtual Testnet's RPC supports `tenderly_setBalance` /
  `tenderly_setErc20Balance` for seeding devnet wallets. Settled during
  Unit 2; fallback is whale impersonation via `vm.prank` which works on
  any RPC.

## Output Structure

Greenfield additions under new top-level `tools/` and extensions of
existing `script/` and `web/`:

```
OVFL/
├── script/
│   ├── OVRFLO.s.sol                    # existing, unchanged
│   ├── SeedLocal.s.sol                 # new (Unit 2)
│   ├── SeedDevnet.s.sol                # new (Unit 2)
│   └── lib/
│       └── OVRFLOTestFixtures.sol      # new (Unit 1)
├── test/fork/
│   └── OVRFLOForkBase.t.sol            # becomes thin shim (Unit 1)
├── tools/
│   ├── envio/                          # vendored sablier-labs/indexers subset (Unit 3)
│   │   ├── NOTICE.md
│   │   ├── config.local.yaml
│   │   ├── streams.graphql
│   │   ├── mappings/
│   │   ├── abi/
│   │   └── docker-compose.yml          # new (Unit 4)
│   └── scripts/
│       ├── bootstrap-local.sh          # new (Unit 6)
│       ├── bootstrap-devnet.sh         # new (Unit 6)
│       └── write-env.sh                # new (Unit 6)
├── web/
│   ├── .env.example                    # updated header count (Unit 6)
│   ├── next.config.ts                  # deletes unwired CSP (Unit 9)
│   ├── vercel.json                     # new (Unit 9)
│   ├── public/_headers                 # new (Unit 9)
│   ├── package.json                    # adds bootstrap + envio scripts (Unit 6)
│   ├── lib/
│   │   ├── config.ts                   # + SABLIER_INDEXER_URL env (Unit 5)
│   │   ├── sablier.ts                  # LockupStream rename (Unit 5)
│   │   ├── errors.ts                   # + classifyUserError (Unit 8)
│   │   └── preflight.ts                # new — simulateContract wrapper (Unit 7)
│   ├── scripts/
│   │   ├── build-csp.mjs               # new (Unit 10)
│   │   └── check-banned-patterns.sh    # new (Unit 10)
│   └── components/
│       ├── NewOvrfloModal.tsx          # preflight + local boundary (Units 7, 8)
│       ├── ClaimModal.tsx              # preflight + local boundary (Units 7, 8)
│       ├── StatusPanel.tsx             # consumes classifyUserError (Unit 8)
│       └── StreamList.tsx              # indexer-down banner (Unit 8)
└── docs/
    └── solutions/developer-experience/
        └── ...                         # new compound entries after ship
```

*This is a scope declaration, not a constraint — implementers may adjust
per-unit layouts if a better shape emerges.*

## High-Level Technical Design

> *This illustrates the intended bootstrap flow and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant Dev as Contributor
    participant Boot as bootstrap-local.sh
    participant Anvil as anvil (--chain-id 1)
    participant Forge as forge script SeedLocal
    participant Envio as Envio (docker-compose)
    participant EnvWrite as write-env.sh
    participant Next as next dev

    Dev->>Boot: npm run bootstrap:local
    Boot->>Boot: precheck: docker, forge, anvil, MAINNET_RPC_URL
    Boot->>Anvil: anvil --fork-url $MAINNET_RPC_URL \
                        --fork-block-number 24609670 \
                        --chain-id 1
    Anvil-->>Boot: RPC ready at :8545
    Boot->>Forge: forge script SeedLocal --rpc-url :8545 --broadcast
    Forge->>Anvil: deploy factory, configure, deploy OVRFLO, \
                   prepare oracle (primary + secondary), add markets, \
                   deal PT + stETH to dev wallet
    Forge-->>Boot: factory address, ovrflo address, dev wallet
    Boot->>Envio: docker compose -f tools/envio/docker-compose.yml up -d
    Envio-->>Boot: Hasura at :8080/v1/graphql (indexing from fork block)
    Boot->>EnvWrite: write .env.local with FACTORY, RPC, INDEXER, etc.
    Boot->>Next: cd web && npm run dev
    Next-->>Dev: http://localhost:3000 against the full stack
```

**Standalone re-runs:** each arrow above is also exposed as an independent
npm script (`anvil:fork`, `deploy:seed:local`, `envio:up`, `env:write:local`,
`ui:dev`) per R2.

**Teardown** (`bootstrap:local:clean`):
`kill anvil` → `docker compose down -v` (wipes the Postgres volume, the
critical step called out by Envio docs for fork resets) → `rm web/.env.local`.

## Implementation Units

### Phase 1 — Solidity seed plumbing

- [ ] **Unit 1: Extract shared fork fixtures into `script/lib/OVRFLOTestFixtures.sol`**

**Goal:** Move constants (`MAINNET_FORK_BLOCK`, `STETH`, `WSTETH`, `WSTETH_SY`,
`PRIMARY_MARKET`, `PRIMARY_PT`, `PRIMARY_EXPIRY`, `SECONDARY_MARKET`,
`SECONDARY_PT`, `SECONDARY_EXPIRY`, `MIN_TWAP_DURATION`, `ORACLE`, `OWNER`,
`TREASURY`) and helpers (`_deployConfiguredSystem`, `_prepareOracle`) from
`OVRFLOForkBase` into a new non-`Test`-derived abstract contract that both
the fork test base and the Forge seed scripts can inherit. Leave behavior
untouched.

**Requirements:** R3, R4.

**Dependencies:** None.

**Files:**
- Create: `script/lib/OVRFLOTestFixtures.sol`
- Modify: `test/fork/OVRFLOForkBase.t.sol` (becomes shim that inherits
  `OVRFLOTestFixtures` + `forge-std/Test` and re-declares nothing)
- Test: `test/fork/OVRFLOMainnetFork.t.sol`,
  `test/fork/OVRFLOFactoryMainnetFork.t.sol` (existing tests must pass
  unchanged — they are the verification gate for this unit)

**Approach:**
- New abstract contract lives in `script/lib/` so Forge scripts can import
  without pulling the `forge-std/Test` dependency that would be incorrect
  for a `.s.sol`.
- `OVRFLOForkBase` becomes roughly:
  ```solidity
  abstract contract OVRFLOForkBase is OVRFLOTestFixtures, Test {
      function setUp() public virtual {
          vm.createSelectFork(vm.envString("MAINNET_RPC_URL"), MAINNET_FORK_BLOCK);
      }
  }
  ```
- The `_seedBalancesAndApprovals` helper in `OVRFLOMainnetFork.t.sol`
  currently uses `deal` + `vm.prank` (test-only cheatcodes). Leave it in
  the test file; seed scripts get a separate `_seedDevWallet` helper on
  the fixtures base that uses `vm.broadcast` instead (wired in Unit 2).

**Execution note:** Run the full Forge test suite before and after the
move; any behavioral diff means the extraction is wrong.

**Patterns to follow:** OpenZeppelin-style abstract-contract inheritance
already used elsewhere in the repo (`OVRFLOToken`).

**Test scenarios:**
- Happy path: `forge test --fork-url $MAINNET_RPC_URL` passes every
  existing fork test at parity with `main`.
- Edge case: Compilation succeeds for both `forge build` and
  `forge test --no-match-path test/fork/*` (unit tests don't accidentally
  require mainnet env).

**Verification:**
- `forge test` exits 0 on the pinned fork block with zero test count
  delta vs `main`.
- `forge build` produces identical bytecode for `OVRFLO`, `OVRFLOFactory`,
  `OVRFLOToken` (mechanical refactor shouldn't touch src/).

---

- [ ] **Unit 2: `SeedLocal.s.sol` and `SeedDevnet.s.sol` Forge scripts**

**Goal:** Two Forge scripts that deploy + configure the factory + vault,
approve the primary and secondary markets, and seed a configurable dev
wallet with PT (+ stETH for fees). Reuses fixtures from Unit 1 so there
is no hardcoded mainnet address in `script/`.

**Requirements:** R1 (partial — seed step), R4, R7, R8.

**Dependencies:** Unit 1.

**Files:**
- Create: `script/SeedLocal.s.sol`
- Create: `script/SeedDevnet.s.sol`

**Approach:**
- Both scripts inherit `OVRFLOTestFixtures` (Unit 1), read a
  `DEV_WALLET` env address, call `_deployConfiguredSystem`,
  `_prepareOracle(PRIMARY_MARKET)` + `_prepareOracle(SECONDARY_MARKET)`,
  then `factory.addMarket(...)` for both, then call a shared `_seedDevWallet`
  helper that `deal`s PT and uses a whale impersonation for stETH (because
  `deal` on stETH is unreliable — rebase-token).
- `SeedLocal` reads `DEV_WALLET` + optional `FEE_BPS` and broadcasts
  against `http://localhost:8545` with the default anvil #0 key.
- `SeedDevnet` reads `TENDERLY_RPC_URL` + `DEV_WALLET` + optional
  `EXISTING_FACTORY` (idempotency flag per R8). When `EXISTING_FACTORY` is
  set and resolves to code, skip deployment and just top-up seeding.
- Both scripts emit the factory address, OVRFLO address, PT balances,
  and the dev wallet via `console2.log` so the bootstrap wrapper can
  parse and write `.env.*`.

**Technical design (directional, not spec):**
```solidity
// SeedLocal.s.sol — high-level shape
contract SeedLocal is Script, OVRFLOTestFixtures {
    function run() external {
        address devWallet = vm.envAddress("DEV_WALLET");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(100)));

        vm.startBroadcast();
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        factory.prepareOracle(PRIMARY_MARKET, address(ORACLE), 30 minutes);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, address(ORACLE), 30 minutes, feeBps);
        factory.prepareOracle(SECONDARY_MARKET, address(ORACLE), 30 minutes);
        factory.addMarket(address(ovrflo), SECONDARY_MARKET, address(ORACLE), 30 minutes, feeBps);
        vm.stopBroadcast();

        _seedDevWallet(devWallet, PRIMARY_PT, SECONDARY_PT, STETH);

        console2.log("FACTORY", address(factory));
        console2.log("OVRFLO", address(ovrflo));
        console2.log("DEV_WALLET", devWallet);
    }
}
```

**Patterns to follow:**
- `script/OVRFLO.s.sol` for `vm.startBroadcast()` scaffolding.
- `OVRFLOMainnetFork.t.sol#_seedBalancesAndApprovals` for the
  stETH `submit{value: …}` pattern — adapt for broadcast context.

**Test scenarios:**
- Integration: run `SeedLocal` against a fresh anvil, query
  `factory.approvedMarketCount()` and confirm `2`.
- Integration: dev wallet has non-zero `IERC20(PRIMARY_PT).balanceOf` and
  `IERC20(SECONDARY_PT).balanceOf`.
- Error path: missing `DEV_WALLET` env exits non-zero with a
  human-readable message (so Unit 6 can surface it).
- Idempotency (devnet only): running `SeedDevnet` with `EXISTING_FACTORY`
  set to a deployed factory address skips redeployment and only tops up
  PT balances; `factory.ovrfloCount()` is unchanged.

**Verification:**
- Both scripts compile under `forge build`.
- SC-1 is partially met: after Unit 2 alone, a contributor can run
  anvil + `forge script SeedLocal` by hand and see deployed contracts.

### Phase 2 — Local Envio Sablier indexer

- [ ] **Unit 3: Vendor Sablier Envio indexer under `tools/envio/`**

**Goal:** Copy `sablier-labs/indexers`'s `envio/streams/` tree into
`tools/envio/` at a pinned SHA, add a local-chain-1 config variant, and
write a `NOTICE.md` that cites upstream + SHA for future bump tracking.
No runtime network dependency after this unit lands.

**Requirements:** R11.

**Dependencies:** None (independent of Unit 1 / Unit 2).

**Files:**
- Create: `tools/envio/config.local.yaml` (chain-id-1 stanza targeting
  `http://host.docker.internal:8545`)
- Create: `tools/envio/streams.graphql` (copied from upstream)
- Create: `tools/envio/mappings/` (copied from upstream)
- Create: `tools/envio/abi/` (copied from upstream)
- Create: `tools/envio/NOTICE.md` (upstream URL, pinned SHA, GPL-3.0
  attribution, list of files copied)
- Create: `tools/envio/README.md` (bump instructions: re-copy tree, update
  SHA in NOTICE, run `npm run envio:reset`)

**Approach:**
- Pin to the latest commit on `main` at the time of implementation; note
  the SHA in `NOTICE.md`. The bump workflow (rare, since this doesn't
  change often) is documented in the README.
- `config.local.yaml` is a *separate file* from upstream's `config.yaml`
  so bumps never collide with our chain-1 customizations. Its `networks`
  block declares `id: 1` with `rpc_config.url: http://host.docker.internal:8545`
  and `start_block` set to `MAINNET_FORK_BLOCK - 100` (a small safety
  margin behind the fork).
- Per `docs/solutions/patterns/ovrflo-critical-patterns.md`, the local
  indexer must answer the exact same GraphQL surface the frontend uses
  post-Unit-5. This unit's verification is explicitly tied to Unit 5's
  test suite passing against the local endpoint.

**Patterns to follow:**
- Typical "vendored third-party" layouts elsewhere in the OSS ecosystem:
  `NOTICE.md` + pinned SHA + minimal override config is the pattern.

**Test scenarios:**
- Test expectation: none for this unit in isolation — validation is
  integration-level and happens in Unit 4 and Unit 5.
- Smoke: `yq` or `grep` checks that `tools/envio/config.local.yaml`
  references chain id 1 and the correct RPC host.

**Verification:**
- `NOTICE.md` references a real SHA on the upstream repo.
- `tools/envio/` contains no files outside what is needed to run the
  indexer (no docs, no CI, no unrelated chains).
- License file preserved per GPL-3.0 redistribution requirement.

---

- [ ] **Unit 4: docker-compose + Envio lifecycle npm scripts**

**Goal:** Spin up the local Envio stack (Postgres + Hasura + indexer
process) against the vendored config with a single command. Teardown
wipes Postgres state so fork restarts are clean.

**Requirements:** R10, R13.

**Dependencies:** Unit 3.

**Files:**
- Create: `tools/envio/docker-compose.yml`
- Modify: `web/package.json` (add `envio:up`, `envio:down`, `envio:reset`,
  `envio:logs` scripts that shell into `tools/envio/`)
- Create: `tools/envio/.env.example` (documents Envio-internal env vars:
  `ENVIO_PG_PORT`, `HASURA_GRAPHQL_ADMIN_SECRET`)

**Approach:**
- `docker-compose.yml` models after Envio's upstream local-docker example
  but inlines the vendored config path. Services:
  - `postgres:15` on a named volume `envio_pgdata`, exposed on 5433 host.
  - `hasura/graphql-engine:v2.x` on 8080 host, admin secret `testing`
    (overridable).
  - `envio/indexer:latest` (pinned tag), mounts `tools/envio/` as
    `/indexer`, runs against `config.local.yaml`.
- `host.docker.internal` is Docker Desktop's default. For Linux, document
  the `--add-host=host.docker.internal:host-gateway` flag in the
  compose file.
- `envio:reset` runs `docker compose down -v` then
  `docker compose up -d` — required whenever anvil's fork block resets,
  per upstream docs' "restarting Anvil produces a different chain."

**Patterns to follow:**
- [`enviodev/local-docker-example`](https://github.com/enviodev/local-docker-example).
- Named-volume teardown pattern (`down -v`) for database resets.

**Test scenarios:**
- Integration: `npm run envio:up` followed by `curl -XPOST
  http://localhost:8080/v1/graphql -d '{"query":"{ LockupStream(limit:1) { id } }"}'`
  returns a well-formed GraphQL response (possibly `[]`, which is
  correct for an empty local chain).
- Integration: `npm run envio:reset` brings the stack down, deletes the
  volume, and restarts cleanly — `docker volume ls | grep envio_pgdata`
  shows the volume recreated.
- Error path: `npm run envio:up` without Docker running exits non-zero
  with a message that Unit 6's bootstrap can surface to the user.

**Verification:**
- R13: catch-up to fork head is sub-30s for an anvil with ≤ a few
  thousand blocks of simulated activity (measured during implementation;
  record a note if this is not achievable and adjust R13 during review).
- Hasura console at `http://localhost:8080` loads and lists `LockupStream`
  as a tracked table.

### Phase 3 — Frontend wiring

- [ ] **Unit 5: Env-driven indexer URL + `Stream` → `LockupStream` rename**

**Goal:** Make `SABLIER_ENVIO_URL` env-driven (`NEXT_PUBLIC_SABLIER_INDEXER_URL`)
with the hosted URL as default. Update `web/lib/sablier.ts` to query the
real `LockupStream` entity. Verify existing field typing against the
upstream schema and fix drift.

**Requirements:** R12, R16 (partial — query correctness).

**Dependencies:** Unit 3 (so local validation is possible).

**Files:**
- Modify: `web/lib/config.ts` (add `SABLIER_INDEXER_URL` env, keep the
  hosted URL as default fallback, add env name to `ENV` object)
- Modify: `web/lib/sablier.ts` (rename query entity `Stream` →
  `LockupStream`; update `SablierStream` interface to match upstream
  schema — particularly `intactAmount`, `canceled`, category fields;
  update response type `StreamsQueryData.Stream` → `.LockupStream`)
- Modify: `web/.env.example` (add `NEXT_PUBLIC_SABLIER_INDEXER_URL=…`
  with comment + bump header "knob count")
- Test: `web/tests/lib/sablier.test.ts` (existing; update expected query
  payload fixture to use `LockupStream`)
- Test: `web/tests/lib/config.test.ts` (existing; add test for
  `SABLIER_INDEXER_URL` env → export)

**Approach:**
- `SABLIER_INDEXER_URL` defaults to the current hosted URL so mainnet
  and devnet flows keep working with zero env change.
- The rename is surgical: query string + typed response + test fixture.
- Upstream `LockupStream` includes a `category` enum (`LockupLinear |
  LockupDynamic | LockupTranched`). OVRFLO uses LockupLinear exclusively;
  add `category: { _eq: "LockupLinear" }` to the `where` clause so the
  UI is future-proof if Sablier's tranched/dynamic variants start
  appearing in the same indexer.
- `depleted` in current `SablierStream` interface is *not* on the
  upstream schema. Derive it in TypeScript from `intactAmount === "0"`
  (or similar) during the map, and drop it from the GraphQL selection.

**Patterns to follow:**
- Existing `web/tests/lib/sablier.test.ts` assertion style (payload
  string matching + response shape).

**Test scenarios:**
- Happy path: fetch with valid payload returns the rename-conformant
  shape; `useStreams` still renders the right number of rows.
- Edge case: empty `ovrfloAddresses` returns `[]` with no network call
  (existing guard at line 76 of `sablier.ts`).
- Error path: `SABLIER_INDEXER_URL` unset → falls back to hosted URL,
  no throw.
- Error path: HTTP 500 / non-JSON response throws `StreamScanError`
  with message that Unit 8's banner will render.
- Integration (local): against a freshly bootstrapped local Envio,
  a deposit+stream produces a row in `useStreams` within the catch-up
  window.

**Verification:**
- `./node_modules/.bin/tsc --noEmit` passes.
- `npm test` passes including updated `sablier.test.ts`.
- Hitting the hosted URL with the new query shape returns streams (no
  regression for mainnet users).

---

- [ ] **Unit 6: Bootstrap orchestration — `bootstrap:local`, `bootstrap:devnet`, `:clean`**

**Goal:** Wire Units 2, 4, 5 into one-shot contributor commands. Each
step remains independently runnable per R2. Fail-fast precheck per R5.
Teardown per R6.

**Requirements:** R1, R2, R5, R6, R7, R8.

**Dependencies:** Unit 2, Unit 4, Unit 5.

**Files:**
- Create: `tools/scripts/bootstrap-local.sh`
- Create: `tools/scripts/bootstrap-devnet.sh`
- Create: `tools/scripts/write-env.sh` (helper that writes `.env.local`
  or `.env.devnet` from parsed forge-script stdout)
- Modify: `web/package.json` (add `anvil:fork`, `deploy:seed:local`,
  `deploy:seed:devnet`, `bootstrap:local`, `bootstrap:local:clean`,
  `bootstrap:devnet`, `bootstrap:devnet:clean`, `env:write:local`,
  `env:write:devnet`, `ui:dev`)
- Modify: `web/.env.example` (single file with commented profile blocks
  per Deferred-to-Implementation decision; contributor uncomments the
  block they need)

**Approach:**
- Bash scripts, not Node. They're thin orchestrators; Node-based task
  runners (concurrently, etc.) hide failure modes.
- Precheck block at the top of `bootstrap-local.sh`:
  ```
  require_cmd docker ; require_cmd anvil ; require_cmd forge ;
  require_cmd npm ; require_env MAINNET_RPC_URL
  ```
  Each `require_*` prints a line like `✗ anvil is not on PATH — install
  Foundry: curl -L https://foundry.paradigm.xyz | bash` and exits 1.
- Anvil runs in background with `--chain-id 1` (Key Decision) and
  `--fork-block-number 24609670` (R3) against `$MAINNET_RPC_URL`.
  PID written to `.bootstrap.pid`; `:clean` reads it and kills.
- After `forge script SeedLocal --broadcast` completes, parse stdout
  `FACTORY 0x...` / `OVRFLO 0x...` lines and feed to `write-env.sh`
  which produces `web/.env.local`. Use `tee` + a marker regex — not an
  elaborate grammar.
- For devnet, parallel flow against `TENDERLY_RPC_URL` (no anvil). The
  `EXISTING_FACTORY` idempotency flag is read from env; if present,
  pass through to `SeedDevnet.s.sol`.
- `:clean` variant: `kill $(cat .bootstrap.pid)` → `npm run envio:reset` →
  `rm web/.env.local` → `rm .bootstrap.pid`. Idempotent.

**Patterns to follow:**
- Project convention: shell scripts with `set -euo pipefail` at the top.

**Test scenarios:**
- Happy path: SC-1 and SC-2 from the origin document pass end-to-end.
  Manual testing during implementation; no automated test (Playwright
  is out of scope).
- Error path: missing `MAINNET_RPC_URL` produces the prechecked message
  in <1s, no partial state.
- Error path: `MAINNET_RPC_URL` set but unreachable — anvil fails
  immediately; bootstrap script exits, does not proceed to forge.
- Edge case: running `bootstrap:local` twice back-to-back without
  `:clean` — second invocation detects the existing anvil PID and
  refuses, or detects the existing `.env.local` and prompts. Settle
  the exact UX in implementation.
- Edge case: running `:clean` with nothing running — exits 0 with a
  "nothing to clean" message, does not error.

**Verification:**
- SC-1, SC-2, SC-3, SC-6 met end-to-end by a contributor running the
  commands on a clean checkout.
- `package.json` scripts list updated and every script referenced in
  this unit exists.
- `.env.example` header comment is accurate on knob count.

### Phase 4 — UI Hardening

- [ ] **Unit 7: wagmi `simulateContract` preflight in write paths**

**Goal:** Before any wallet prompt for deposit, claim, or withdrawMax,
run `simulateContract` against the same args. On simulation failure,
render a human error from the Unit 8 taxonomy and suppress the wallet
prompt. Successful simulation proceeds to `writeContract`.

**Requirements:** R15.

**Dependencies:** Unit 8 (error taxonomy used for the error render).
May land in either order if Unit 8's taxonomy stub exists first.

**Files:**
- Create: `web/lib/preflight.ts` (pure function that takes a simulation
  request and returns `{ ok: true, request } | { ok: false, error }`)
- Modify: `web/components/NewOvrfloModal.tsx` (deposit path: simulate
  → gate submit; show preflight-failure state inline)
- Modify: `web/components/ClaimModal.tsx` (claim path)
- Modify: `web/components/StreamTableRow.tsx` (withdrawMax path on
  Sablier)
- Test: `web/tests/lib/preflight.test.ts` (new)
- Test: `web/tests/components/NewOvrfloModal.test.tsx`,
  `ClaimModal.test.tsx` (extend existing; add preflight-fail scenarios
  once they exist — create if absent)

**Approach:**
- `preflight.ts` wraps `publicClient.simulateContract` with viem error
  classification (`ContractFunctionRevertedError`,
  `ContractFunctionExecutionError`, `UserRejectedRequestError`). Output
  is a discriminated union consumable by the modal.
- Modal buttons keep the existing `writeContract` call but gate it on
  `ok === true`. On `ok === false`, the error message renders in the
  modal's existing `StatusPanel` slot.
- Slippage (`minToUser` for deposit) is part of the simulated args, so
  slippage failures surface here.
- `withdrawMax` preflight is against Sablier directly, not OVRFLO.

**Technical design (directional, not spec):**
```tsx
// NewOvrfloModal deposit click handler — shape
const sim = await preflight({
  address: ovrfloAddress,
  abi: ovrfloAbi,
  functionName: "deposit",
  args: [marketAddress, ptAmount, minToUser],
  account,
});
if (!sim.ok) {
  setStatus({ kind: sim.error.kind, message: sim.error.message });
  return; // no wallet prompt
}
writeContract(sim.request);
```

**Patterns to follow:**
- Existing `StatusPanel` as the error render surface.
- wagmi v2 `useSimulateContract` is an option, but the preflight wants
  to run *at click time* against the current form state, so a direct
  `publicClient.simulateContract` call is simpler than re-running the
  hook.

**Test scenarios:**
- Happy path: valid deposit args → `ok: true`, returned `request` can
  be passed to `writeContract`.
- Error path: insufficient PT balance → `ok: false` with `kind:
  "insufficient-balance"`, message includes the token symbol.
- Error path: slippage (minToUser > actual previewToUser) → `ok: false`
  with `kind: "slippage"`.
- Error path: market expired → `ok: false` with `kind: "market-expired"`.
- Error path: user rejection in the preflight phase shouldn't happen
  (simulation doesn't prompt), so this path is asserted *not* to appear.
- Integration: deposit flow with failing preflight never triggers a
  `writeContract` spy.

**Verification:**
- All preflight paths in deposit/claim/withdrawMax gate the wallet
  prompt; simulated failures never reach the wallet.
- Component tests pass.

---

- [ ] **Unit 8: Error taxonomy + outage banners**

**Goal:** Extend `lib/errors.ts` with `classifyUserError` and a small
taxonomy. Route wallet/network/indexer/RPC errors through it. Add a
Sablier-indexer-down banner to the streams section that stays silent
on CoinGecko failures (CoinGecko degrades to no-USD, per origin doc).

**Requirements:** R16, R17, R18 (partial — lint rule lands in Unit 9),
R22.

**Dependencies:** Unit 5 (uses typed `StreamScanError`).

**Files:**
- Modify: `web/lib/errors.ts` (add `classifyUserError` + `UserErrorKind`
  union type)
- Modify: `web/components/StatusPanel.tsx` (consume `UserErrorKind`
  to render tone-aware copy + recovery actions)
- Modify: `web/components/StreamList.tsx` (indexer-down banner)
- Modify: `web/components/WrongNetworkBanner.tsx`,
  `web/components/NetworkGuard.tsx` (align to new taxonomy — reuse
  existing copy)
- Test: `web/tests/lib/errors.test.ts` (extend; add taxonomy tests)
- Test: `web/tests/components/StreamList.test.tsx` (new or extend;
  indexer-down banner scenario)

**Approach:**
- `UserErrorKind = "user-rejected" | "wrong-network" |
  "insufficient-balance" | "slippage" | "market-expired" |
  "indexer-down" | "rpc-down" | "unknown"`.
- `classifyUserError(error): { kind: UserErrorKind; message: string }`
  pattern-matches on viem error class, wagmi connector error codes,
  and the `StreamScanError` from `sablier.ts`. Falls through to
  `"unknown"` with `getErrorMessage`-derived message.
- `StreamList` wraps its `useStreams` error in the banner: "Sablier
  indexer is unavailable — streams may be out of date. Retrying…" —
  matches pattern #1's "empty state + retry UI" fallback. Tests
  verify no log-scan fallback is triggered.
- CoinGecko failures remain silent per
  `docs/solutions/ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md`;
  USD sublines drop conditionally; no banner.

**Patterns to follow:**
- Existing `getErrorMessage` / `isFrontendConfigError` style:
  pure functions, no side effects, narrow types.

**Test scenarios:**
- Happy path: `classifyUserError(new UserRejectedRequestError(...))`
  returns `{ kind: "user-rejected", ... }`.
- Happy path: `classifyUserError(new StreamScanError(...))` returns
  `{ kind: "indexer-down", ... }`.
- Edge case: wrong-network error from wagmi's connector returns
  `{ kind: "wrong-network", ... }`.
- Edge case: unknown error falls through to `{ kind: "unknown",
  message: getErrorMessage(...) }`.
- Integration: `StreamList` with mocked `fetchUserStreams` that throws
  `StreamScanError` shows the indexer banner and not an error boundary.
- Anti-regression: test the banned-log-scan fallback by asserting that
  `StreamList` in the error state does not call `publicClient.getLogs`.

**Verification:**
- `npm test` passes with new coverage.
- Manual verification: blocking the hosted indexer URL in devtools
  triggers the banner, not a blank Streams card.

---

- [ ] **Unit 9: Modal error boundaries + `app/error.tsx` verification**

**Goal:** Wrap `NewOvrfloModal` and `ClaimModal` internals in local
React error boundaries so a `useReadContracts` blow-up inside the modal
doesn't take down the whole dashboard. Verify the existing `app/error.tsx`
and `app/global-error.tsx` render recoverable fallbacks for realistic
failure modes (RPC unreachable, malformed env, wallet disconnect
mid-render).

**Requirements:** R14, R22.

**Dependencies:** Unit 8 (recovery UI uses the taxonomy).

**Files:**
- Create: `web/components/ModalErrorBoundary.tsx` (client component;
  renders a "something went wrong — try again" with a reset button
  that calls the provided `onReset`)
- Modify: `web/components/NewOvrfloModal.tsx` (wrap body in boundary)
- Modify: `web/components/ClaimModal.tsx` (wrap body in boundary)
- Verify (no change expected): `web/app/error.tsx`,
  `web/app/global-error.tsx`
- Test: `web/tests/components/ModalErrorBoundary.test.tsx` (new)

**Approach:**
- React 19 + Next.js 16 still use the class-component error boundary
  pattern (no hooks API shipping in 19 yet). Minimal
  `componentDidCatch` + `getDerivedStateFromError`.
- Boundary wraps only the data-fetch + write-path region; header and
  close button stay outside the boundary so the modal is always
  dismissable.
- Verification of `app/error.tsx` is manual: reproduce each failure
  mode (RPC down, bad env, disconnected mid-render) with DevTools and
  confirm the page recovers without a full reload.

**Patterns to follow:**
- React docs' canonical class-component error boundary.

**Test scenarios:**
- Happy path: boundary with children that don't throw renders them
  unchanged.
- Error path: child throws → boundary renders fallback with reset button.
- Integration: clicking the reset button re-renders the child tree
  (verified by a counter prop).
- Manual scenarios for `app/error.tsx`:
  - RPC set to `http://localhost:1` (port 1, guaranteed closed) → page
    renders error UI, not a blank screen.
  - Malformed env (`NEXT_PUBLIC_OVRFLO_FACTORY=xyz`) → build fails (good)
    or dev-server renders config-error message from `lib/config.ts`.

**Verification:**
- Both modals survive a thrown error in their data hooks.
- No regression in existing modal tests.

---

- [ ] **Unit 10: Packaging + CSP relocation + static-export verification + banned-pattern CI**

**Goal:** Delete the unwired CSP from `next.config.ts`, move it to
`vercel.json` and `public/_headers` parameterized by build-time env
origins, verify the static export is clean today, add CI guards for
future regressions.

**Requirements:** R18 (lint rule for `console.*`), R19, R20, R21, R22.

**Dependencies:** Unit 5 (needs `NEXT_PUBLIC_SABLIER_INDEXER_URL`
exported for `connect-src` substitution).

**Files:**
- Modify: `web/next.config.ts` (delete `securityHeaders` array —
  unwired + no-op under static export)
- Create: `web/vercel.json` (static-asset headers including CSP)
- Create: `web/public/_headers` (Cloudflare Pages / Netlify equivalent)
- Create: `web/scripts/build-csp.mjs` (reads env, substitutes into a
  CSP template, writes `vercel.json` + `public/_headers`)
- Modify: `web/package.json` (`build` script becomes `node
  scripts/build-csp.mjs && next build`; add `lint:security`,
  `lint:banned-patterns`)
- Modify: `web/eslint.config.*` (add `no-console` rule set to `error`,
  with `allow: ["warn", "error"]` if the project already uses those)
- Create: `web/scripts/check-banned-patterns.sh` (ripgrep smoke
  check — fails CI if any of the following appear in `web/lib` or
  `web/hooks` or `web/components`: `FACTORY_FROM_BLOCK`,
  `useApprovedMarkets`, `parseStreamError`, `"Deposited"`,
  `nativeUsd`, `watchContractEvent.*Deposited`,
  `getLogs.*Deposited`)
- Test: `web/tests/lib/constants.test.ts` (extend; verify
  `SABLIER_INDEXER_URL` and `PRICE_API_URL` are both exported)

**Approach:**
- CSP template lives in the build script as a template literal with
  `${RPC}`, `${INDEXER}`, `${PRICE_API}` placeholders. Script reads
  env at build time, emits `vercel.json` and `public/_headers` with
  substituted origins.
- `vercel.json` is Vercel's authoritative header format; `_headers` is
  Cloudflare/Netlify's. Emitting both means no change needed to deploy
  to either surface.
- Static-export verification: build script also runs `next build`,
  then asserts `out/` exists and contains no
  `server/pages-manifest.json` (indicator of accidental server code).
  Fails the build otherwise.
- `check-banned-patterns.sh` runs as the first step of `npm test` (or
  as a separate `lint:banned-patterns` if test bundling is unwanted).

**Patterns to follow:**
- [Vercel `vercel.json` headers spec](https://vercel.com/docs/projects/project-configuration#headers).
- [Cloudflare Pages `_headers`](https://developers.cloudflare.com/pages/configuration/headers/).

**Test scenarios:**
- Happy path: `npm run build` exits 0, `out/` contains static files
  only, `vercel.json` + `public/_headers` contain the configured RPC
  and indexer origins.
- Error path: missing `NEXT_PUBLIC_RPC_URL` at build time → build
  script exits non-zero with clear message.
- Error path: intentionally adding `console.log("x")` to any file in
  `web/components` → `npm run lint` fails.
- Error path: intentionally adding `FACTORY_FROM_BLOCK` reference →
  `npm run lint:banned-patterns` fails with the match line.
- Verification: CSP `connect-src` contains `http://localhost:8080`
  (indexer) and `http://localhost:8545` (RPC) when built with the
  local profile.

**Verification:**
- R19: `next build` with `output: "export"` produces an `out/` with no
  server manifest; CI gate fails if that invariant breaks.
- R20: `vercel.json` and `public/_headers` contain CSP that references
  env-configured origins; `next.config.ts` no longer contains the dead
  array.
- R21: any non-`NEXT_PUBLIC_*` env reference in `web/{lib,components,hooks,app}`
  fails CI (covered by existing env-check test in
  `tests/lib/constants.test.ts`; extend as needed).

---

- [ ] **Unit 11: A11y sweep + external-link audit + ENS truncation check**

**Goal:** Single-shot `@axe-core/cli` audit of the four primary surfaces
(dashboard, deposit modal, claim modal, streams table). Fix issues
until the axe report is clean at Serious/Critical level. Grep audit
for external `<a>` tags missing `rel`. Verify ENS + safe truncation
on addresses and tx hashes.

**Requirements:** R23, R24, R25.

**Dependencies:** Units 5–10 (want to audit the *final* UI, not an
intermediate one).

**Files:**
- Create: `web/scripts/a11y-sweep.sh` (boots `npm run dev`, runs
  `@axe-core/cli` against the four routes, prints report)
- Modify: `web/package.json` (add `@axe-core/cli` devDep, `a11y` script)
- Modify: components surfacing accessibility fixes (to be discovered
  during the sweep — not pre-listed)
- Potentially modify: `web/hooks/useTokenLabels.ts` or a new
  `useEnsName` hook if ENS resolution isn't already in place.
- Test: no new tests — manual audit drives fixes, regressions are
  caught by TypeScript + existing component tests.

**Approach:**
- Pin `@axe-core/cli` version. Running it against `npm run dev` (not
  the static build) is acceptable — axe doesn't care which renderer.
- Modal focus-trap: React Aria's `FocusScope` or a minimal custom hook.
  Pick during the sweep based on what's easiest.
- External-link audit: `rg '<a [^>]*href="http' web/components
  web/app` then manual check for `rel="noopener noreferrer"`.
- ENS resolution: wagmi's `useEnsName` hook against the configured
  public client; fallback to address truncation (`0x1234...5678`) with
  a monospace font.

**Execution note:** Keep this unit last so the a11y work targets the
final UI. Running it before Units 7–9 would produce findings that
Units 7–9 would immediately invalidate.

**Patterns to follow:**
- [`@axe-core/cli`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli) docs.

**Test scenarios:**
- Manual: axe report at Serious/Critical shows zero findings on the
  four primary surfaces.
- Happy path: tabbing through the deposit modal stays within the
  modal until dismissed.
- Edge case: ENS resolution on local anvil returns a name for a known
  `.eth` address (anvil forks mainnet, so ENS registry is available).
- Edge case: ENS resolution failure or missing name → truncated
  address shown, no error rendered.

**Verification:**
- `npm run a11y` passes at Serious/Critical on all four routes.
- `rg '<a [^>]*href="http'` returns zero matches missing
  `rel="noopener noreferrer"`.
- SC-4 target: Lighthouse Accessibility ≥ 95 on the dashboard.

## System-Wide Impact

- **Interaction graph:** Preflight gate wraps every wallet-writing
  interaction; the error taxonomy surfaces through `StatusPanel`,
  `StreamList`, `WrongNetworkBanner`, `NetworkGuard`, and both modals.
  Changing `classifyUserError` affects all of those simultaneously.
- **Error propagation:** Three distinct paths — (a) preflight failures
  stay inside the initiating modal, (b) render-time failures propagate
  to the nearest modal boundary (Unit 9), (c) app-level crashes reach
  `app/error.tsx` (Unit 9 verification). `StreamScanError` travels
  through `useStreams` → React Query error → `StreamList` banner
  (Unit 8), never to the app-level boundary.
- **State lifecycle risks:** Anvil restart without `envio:reset` leaves
  Postgres with stale stream state at a stale fork block. Mitigation:
  `bootstrap:local:clean` runs `envio:reset` as a step; bootstrap script
  detects an anvil PID on disk and refuses a second up without clean.
- **API surface parity:** The GraphQL query lives in one place
  (`web/lib/sablier.ts`); the test fixture in
  `web/tests/lib/sablier.test.ts` enforces the payload shape.
- **Integration coverage:** SC-2 is the integration gate — the full
  deposit → stream → withdraw → claim flow against a freshly
  bootstrapped stack. No automated E2E (Playwright deferred), so
  implementers verify manually and document in the ship PR.
- **Unchanged invariants:** `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`,
  `src/OVRFLOToken.sol` are not modified. Existing fork-tests pass
  unchanged post-Unit-1. The `Dashboard → modal` USD prop-drill pattern
  is preserved (entry #3 in `docs/solutions/ui-bugs`). Log-scan
  fallback remains banned (pattern #1).

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Envio's `LockupStream` schema evolves upstream, breaking vendored mappings | Medium | Medium | Pin SHA in `NOTICE.md`; documented bump workflow in `tools/envio/README.md`; schema drift surfaces as a test failure in `web/tests/lib/sablier.test.ts` |
| Local anvil + Envio catch-up exceeds R13's 30s target | Medium | Low | `start_block` set near fork head, not Sablier's mainnet deploy; if still slow, re-negotiate R13 during Unit 4 (non-blocking for SC-1 if adjusted) |
| `simulateContract` error subclasses in viem change shape between minor versions | Low | Medium | Pin viem version; `classifyUserError` has explicit fallback to `"unknown"` + `getErrorMessage`, so unknown errors still render instead of crashing |
| `output: "export"` prevents some wagmi/Reown feature we haven't exercised | Low | High | Commit `407678e` already de-risked hydration; Unit 10's build gate catches any new server-code regression immediately |
| Docker Desktop on contributor machine uses `host.docker.internal` with different semantics on Linux | Medium | Medium | `docker-compose.yml` includes `--add-host=host.docker.internal:host-gateway` for Linux portability |
| CSP `unsafe-inline` requirement on `script-src` under Next.js 16 static export bakes a weaker policy than desired | Medium | Low | Audit in Unit 10 determines whether `unsafe-inline` is actually needed; if not, drop; if yes, document and accept |
| Tenderly Virtual Testnet RPC does not support `tenderly_setErc20Balance` | Low | Medium | Fall back to whale-impersonation via `vm.prank` in `SeedDevnet.s.sol` (already works on any RPC) |
| GPL-3.0 vendoring in `tools/envio/` creates license ambiguity for the rest of the repo | Low | Medium | `NOTICE.md` scopes GPL-3.0 exclusively to `tools/envio/`; OVRFLO's own code is UNLICENSED per existing headers. Vendoring into a distinct tree matches the standard approach |

## Phased Delivery

**Phase 1 (Units 1–2): Seed plumbing.** Solid Solidity foundation. Can
be reviewed independently. Merges without affecting the UI.

**Phase 2 (Units 3–4): Local Envio.** Brings up the indexer half of the
local loop. Independent of UI changes; can merge in parallel with
Phase 1 if reviewers are separate.

**Phase 3 (Units 5–6): Frontend wiring + bootstrap.** Integrates Phases
1 and 2 into a single contributor command. After this phase ships,
**SC-1, SC-2, SC-3, SC-6 are met.** This is a natural "mid-project
checkpoint" for demo.

**Phase 4 (Units 7–11): UI hardening.** Each unit ships as its own PR
against the now-working local loop. Reviewers validate against real
contract state rather than mocks. Land order: 8 (taxonomy) → 7
(preflight, consumes taxonomy) → 9 (boundaries) → 10 (packaging/CSP)
→ 11 (a11y, validated against the final UI).

## Documentation Plan

- Update `CLAUDE.md` / `AGENTS.md` to mention `docs/solutions/` as
  required reading for future agents (carrying forward the
  discoverability issue surfaced during previous session).
- New `docs/solutions/` entries after ship:
  - `developer-experience/local-anvil-loop-WebUI-<date>.md` — how the
    bootstrap works + debugging tips.
  - `integration-issues/sablier-envio-local-indexer-WebUI-<date>.md` —
    the `Stream` → `LockupStream` gotcha + chain-id trap + vendoring
    rationale, so the next contributor bumping the indexer doesn't
    re-discover any of it.
  - Possibly `patterns/csp-for-static-export.md` if a useful generic
    pattern falls out of Unit 10.
- `README.md` at repo root updated with a "Local development" section
  pointing at `npm run bootstrap:local`.

## Operational / Rollout Notes

- No production rollout concerns — this work targets local and devnet
  environments plus packaging. The mainnet deployment is unchanged.
- The hosted Sablier Envio URL continues to back devnet and mainnet;
  no production dependency on the local indexer.
- Contributor onboarding post-ship: `docker` install becomes a
  prerequisite; add a line to the repo README.

## Sources & References

- **Origin document:** [docs/brainstorms/web-production-readiness-requirements.md](../brainstorms/web-production-readiness-requirements.md)
- **Fork tests:** `test/fork/OVRFLOForkBase.t.sol`, `test/fork/OVRFLOMainnetFork.t.sol`
- **Institutional learnings:**
  - `docs/solutions/patterns/ovrflo-critical-patterns.md` (pattern #1)
  - `docs/solutions/integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md`
  - `docs/solutions/ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md`
  - `docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md`
- **External (Sablier):** [sablier-labs/indexers](https://github.com/sablier-labs/indexers)
- **External (Envio):** [Running Locally](https://docs.envio.dev/docs/HyperIndex/running-locally), [Local Anvil](https://docs.envio.dev/docs/HyperIndex/local-anvil), [Common Issues](https://docs.envio.dev/docs/HyperIndex/common-issues)
- **External (CSP):** [Vercel headers](https://vercel.com/docs/projects/project-configuration#headers), [Cloudflare Pages `_headers`](https://developers.cloudflare.com/pages/configuration/headers/)
- **External (axe):** [@axe-core/cli](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli)
