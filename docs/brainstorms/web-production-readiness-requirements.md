---
date: 2026-04-21
topic: web-production-readiness
---

# OVRFLO Web Production Readiness (Local Anvil + Tenderly Devnet + Hardening Pass)

## Problem Frame

The OVRFLO web app (`web/`) is functionally complete — deposit, claim, withdraw,
USD pricing, stream discovery via Envio, and env-driven config across three
profiles (local / dev / mainnet) are all in place. What's missing is the
machinery to *exercise* the UI against real contracts on demand, and the
production hardening a permissionless DeFi UI needs before it is pointed at
users.

Today a contributor cannot, in one command, spin up a mainnet-forked anvil,
deploy the factory + an OVRFLO vault, seed a dev wallet with PT, index local
Sablier events, and open the UI wired to that stack. The path to devnet
(Tenderly Virtual Testnet) has the same shape and no automation. And the UI
itself still has hardening gaps typical of a v0 — error boundaries, transaction
preflight, outage-tolerance for Envio and CoinGecko, CSP, a clean
static-export build, and unambiguous wallet/network failure rendering.

This document captures the product decisions around that work so planning
(`/ce:plan`) can sequence the implementation without re-making product calls.

## Requirements

### Orchestration — Local Anvil

- **R1.** One command (`npm run bootstrap:local` or equivalent) must start a
  mainnet-forked anvil, deploy the OVRFLO factory + a vault with at least two
  approved markets, seed a dev wallet with PT (and stETH for fees), bring up
  a local Sablier Envio indexer, write `web/.env.local`, and start `next dev`.
- **R2.** Every individual step must also be runnable on its own (anvil,
  deploy, seed, envio up, env write, ui dev). Composable scripts, not a
  single opaque bash file.
- **R3.** The anvil fork must pin `--fork-block-number` to the same block
  used by the Forge fork tests (`MAINNET_FORK_BLOCK` in
  `test/fork/OVRFLOForkBase.t.sol`, currently `24_609_670`) so previews,
  rates, and USD-price fixtures are reproducible across contributors.
- **R4.** The local seed logic must **reuse the constants and helpers from
  `test/fork/OVRFLOForkBase.t.sol`** (`PRIMARY_MARKET`, `SECONDARY_MARKET`,
  `STETH`, `ORACLE`, `_deployConfiguredSystem`, `_prepareOracle`,
  `_deployApprovedPrimarySeries`, `_seedBalancesAndApprovals`). Planning
  should extract these into a shared location (e.g.
  `script/lib/OVRFLOTestFixtures.sol`) rather than duplicating them.
- **R5.** Bootstrap must fail-fast with a clear, actionable message if
  `docker`, `forge`, `anvil`, `npm`, or `MAINNET_RPC_URL` are missing or
  misconfigured.
- **R6.** Tearing down and restarting the local stack must be a single
  command (`npm run bootstrap:local:clean` or equivalent) that wipes anvil
  state, Envio's Postgres volume, and the written `.env.local`.

### Orchestration — Tenderly Devnet

- **R7.** A parallel `bootstrap:devnet` flow must deploy the factory +
  vault against a Tenderly Virtual Testnet RPC (read from env), seed the
  same primary + secondary markets, produce a `.env.devnet`, and print
  addresses to stdout for later reuse.
- **R8.** The devnet flow must be idempotent: re-running it against an
  existing Tenderly testnet either reuses the deployed factory (if env
  references an address that still resolves) or redeploys and updates the
  env file, user's choice via a flag.
- **R9.** Devnet uses the hosted Sablier Envio indexer (the existing
  `https://indexer.hyperindex.xyz/...` URL). No local indexer required in
  this flow; devnet inherits mainnet's pre-fork Sablier history.

### Local Sablier Indexer

- **R10.** A local Envio Hyperindex instance must run via docker-compose
  against the local anvil RPC so that Sablier streams created by local
  deposits surface in the UI's Streams table.
- **R11.** The Sablier Envio config must be vendored under `tools/envio/`
  (not cloned at runtime) so the local flow has no network dependency
  after the initial `npm install`.
- **R12.** The UI must read the indexer URL from a new env knob
  (`NEXT_PUBLIC_SABLIER_INDEXER_URL`) that defaults to the current hosted
  URL, replacing the hardcoded `SABLIER_ENVIO_URL` constant in
  `web/lib/config.ts`.
- **R13.** The local indexer must be seeded only with events from anvil's
  fork block forward; no mainnet-history replay. Catch-up time after
  startup must be sub-30-seconds in the happy path.

### UI Hardening Pass — Reliability

- **R14.** Verify that the existing app-router error boundaries
  (`web/app/error.tsx`, `web/app/global-error.tsx`) actually render a
  recoverable fallback on every realistic failure mode (RPC down, indexer
  500, wallet disconnect mid-tx, malformed env). Extend coverage inside
  modals (`NewOvrfloModal`, `ClaimModal`) where a single
  `useReadContracts` failure currently has no local boundary.
- **R15.** Deposit, claim, and withdraw buttons must run a transaction
  preflight (wagmi `simulateContract` or equivalent) and surface human
  errors (slippage, insufficient balance, expired market, not-yet-matured)
  from `web/lib/tx-errors.ts`'s `parseUserError` before the wallet prompt
  appears. No silent wallet-level reverts.
- **R16.** Envio and CoinGecko outages must degrade gracefully: streams
  table shows an "indexer unavailable — retrying" banner and keeps the
  rest of the dashboard usable; USD sublines disappear cleanly when
  pricing is absent (today's fallback, verify it still holds).
- **R17.** Wallet connection failures (user rejected, wrong network,
  unsupported chain, injected provider missing) must render a specific
  message, not a generic "connection failed."
- **R18.** No `console.log`, `console.debug`, or stray `debugger`
  statements in any client-bundle path. A lint rule or CI check must
  enforce this going forward.

### UI Hardening Pass — Packaging and Security

- **R19.** `web/next.config.ts` already sets `output: "export"`. Verify
  that `npm run build` produces a clean static bundle today (zero
  runtime env reads, no accidental server code, all `NEXT_PUBLIC_*`
  baked at build time) and add a CI check that fails if future changes
  reintroduce non-static behaviour (dynamic route handlers, server
  components doing fetch at request time, `revalidate: n`).
- **R20.** `web/next.config.ts` currently defines a `securityHeaders`
  array (including a CSP) but never wires it into the exported config —
  and even if it did, `headers()` doesn't apply to `output: "export"`
  builds. Relocate those headers to the actual CDN surface
  (`vercel.json`, `public/_headers`, or equivalent per deployment
  target) and update `connect-src` to include env-configured RPC,
  indexer, and price-API origins instead of the hardcoded
  `indexer.hyperindex.xyz` / `*.alchemy.com` set in place today. Keep
  `frame-ancestors 'none'`, keep script-src tight, and drop the unused
  in-config copy to avoid confusing future contributors.
- **R21.** No secrets may appear in the client bundle. A build-time check
  must fail the build if anything not prefixed with `NEXT_PUBLIC_` is
  referenced client-side.
- **R22.** `npm run lint` and `npm run test` must both pass clean on the
  hardening PR; no pre-existing warnings reintroduced.

### UI Hardening Pass — Accessibility and Polish

- **R23.** A single a11y sweep on the dashboard, deposit modal, claim
  modal, and streams table: keyboard focus traps inside open modals, all
  interactive elements have accessible names, color contrast meets WCAG
  AA on the primary palette.
- **R24.** All external links include `rel="noopener noreferrer"` and
  reasonable target behavior.
- **R25.** Long addresses and transaction hashes shown in the UI must be
  ENS-resolved where possible and truncated safely when not.

## Success Criteria

- **SC-1.** A contributor clones the repo, copies `.env.example.forge`
  (with their own `MAINNET_RPC_URL`), runs one command, and within
  ~60 seconds has: a forked anvil, a deployed factory + OVRFLO vault with
  two approved markets, a funded dev wallet, a running Envio indexer, and
  a Next.js dev server pointed at all of the above.
- **SC-2.** From that cold-start they can connect a wallet (MetaMask set
  to the local anvil RPC), submit a deposit on the primary market, see
  the resulting Sablier stream appear in the Streams table within
  ~10 seconds, withdraw streamed funds, warp anvil to market expiry
  (`cast rpc evm_setNextBlockTimestamp …`), and claim the underlying PT
  — all from the UI, no CLI intervention.
- **SC-3.** The same contributor can run `bootstrap:devnet` and repeat
  SC-2 against a Tenderly Virtual Testnet with no code changes, only a
  different env file.
- **SC-4.** `npm run build` produces a static bundle that passes a
  Lighthouse pass (Performance ≥ 85, Accessibility ≥ 95, Best Practices
  100, SEO ≥ 90) on the dashboard when served over HTTPS by any CDN.
- **SC-5.** The hardening PR adds no new runtime dependencies that break
  static export (no `getServerSideProps`, no route handlers executed at
  request time, no `revalidate: n` on server components).
- **SC-6.** Every documented `npm run` script, plus `npm run lint`,
  `npm run test`, and `npm run build`, exits zero on a clean clone.

## Scope Boundaries

- **Out of scope (deferred):** Playwright CI smoke tests, analytics,
  onboarding/first-use flow, i18n scaffolding, Sentry or equivalent
  error reporting, feature flags, terms/privacy copy, status-page
  integration. These are the "launch-ready" tier; this pass targets
  "hardening" per the brainstorm decision.
- **Out of scope (deliberate non-goal):** supporting any chain other than
  mainnet. The three profiles (local / devnet / mainnet) all run against
  mainnet or a mainnet fork; this is enforced in `web/lib/config.ts`
  today and does not change.
- **Out of scope (deliberate non-goal):** re-introducing on-chain
  `Deposited`-event scanning for Sablier discovery. Pattern #1 in
  `docs/solutions/patterns/ovrflo-critical-patterns.md` forbids it; the
  local Envio indexer is the sanctioned substitute.
- **Out of scope (deliberate non-goal):** public-testnet deploys
  (Sepolia, Holesky). OVRFLO hardcodes mainnet Pendle/Sablier addresses;
  public testnets would require a separate cross-chain discussion.
- **Out of scope:** any changes to Solidity contracts in `src/*`. Extracting
  shared fixtures into `script/lib/` is mechanical refactor, not a
  behavioral change, and must leave existing tests green.
- **Out of scope:** running the Sablier Envio indexer in production. The
  hosted URL continues to back devnet and mainnet.

## Key Decisions

- **Devnet = Tenderly Virtual Testnet.** Stable RPC, carries mainnet state
  through fork block, supports `tenderly_*` RPC methods for impersonation.
  Rationale: public testnets are unusable (no Pendle/Sablier), self-hosted
  anvil is fragile for shared dev, CI-ephemeral forks would require
  Playwright which is out of scope for this pass.
- **Local streams surface via a local Envio indexer.** Hosted Envio
  indexes mainnet only and anvil-local Sablier events never reach it.
  The alternative (re-introducing `eth_getLogs` scanning) was explicitly
  ruled out by `docs/solutions/patterns/ovrflo-critical-patterns.md`.
  Cost of local Envio: a Docker dependency on dev machines — accepted.
- **Hardening scope, not launch scope.** Error boundaries, preflight,
  outage handling, CSP, static-export cleanliness, a11y sweep are in.
  Analytics, onboarding, i18n, error-reporting pipelines are deferred
  to a follow-up brainstorm.
- **Static export target on a managed edge host.** Matches the direction
  already set by commit `407678e` ("Fix static export hydration").
  Keeps the operational surface small and supports future IPFS pinning
  without more work.
- **Reuse fork-test fixtures.** Constants and helpers in
  `test/fork/OVRFLOForkBase.t.sol` are proven; promoting them to a shared
  library used by both the tests and the new seeding script avoids
  drift and deletes duplication.
- **Tooling first, then hardening.** Approach 1 from Phase 2. Infra
  work is horizontal; slicing by UI flow would create churn with no
  speedup. Hardening against a real local loop catches failure modes
  that would be guessed otherwise.

## Dependencies / Assumptions

- **D1.** Contributors will install Docker (Desktop or Colima) on their
  dev machine. Verified by checking `docker` on PATH during bootstrap.
- **D2.** `MAINNET_RPC_URL` must be set in the contributor's environment
  (already required by the Forge fork tests per
  `test/fork/OVRFLOForkBase.t.sol` line 28).
- **D3.** Reown / WalletConnect project id is already required by the
  UI (verified in `web/lib/config.ts`). No new auth surface.
- **D4.** Tenderly account with Virtual Testnet access is assumed for
  the devnet path. The team already references this in
  `web/.env.example`; no further procurement decision needed.
- **D5.** The Sablier team publishes an Envio Hyperindex config that
  covers the V2 Lockup Linear contract we integrate with. If they do
  not, we vendor a minimal config that tracks only the events the UI
  query (`web/lib/sablier.ts`) needs.
- **D6.** Next.js 16 static export supports the app-router patterns
  currently in `web/app/`. Verified by commit `407678e`'s hydration fix;
  to be re-confirmed during planning.
- **D7.** `web/next.config.ts` already sets `output: "export"` and
  declares an (unwired) CSP. Verified by reading the file during
  brainstorm. This shapes R19/R20 into verification + relocation tasks,
  not greenfield work.

## Outstanding Questions

### Resolve Before Planning

_(none — product direction is resolved.)_

### Deferred to Planning

- **[Affects R4] [Technical]** Where should the shared fixtures live —
  `script/lib/OVRFLOTestFixtures.sol`, `test/shared/`, or a new top-level
  location? Must be importable from both `test/fork/*` and
  `script/*.s.sol` without creating circular deps.
- **[Affects R10, D5] [Needs research]** Does Sablier Labs publish a
  reusable HyperIndex / Envio config for V2 Lockup Linear? If yes,
  vendor theirs; if no, write a minimal one targeting just
  `Stream{recipient, sender, contract, chainId, depositAmount, …}`
  fields the UI reads.
- **[Affects R10] [Technical]** Envio's bind address inside the
  container and how it maps to `http://127.0.0.1:<port>/v1/graphql`;
  verify the default port and whether Postgres needs a named volume
  for stable restarts.
- **[Affects R15] [Technical]** Which view functions exactly should
  preflight call — `previewDeposit`, `previewStream`, `previewRate`,
  or a new aggregate. Evaluate whether `simulateContract` against the
  write function itself gives better ergonomics.
- **[Affects R19] [Technical]** Next.js 16 + `next export` + Turbopack
  interaction with route-handler-less app-router. Spot-check that no
  implicit server code leaks into the static output.
- **[Affects R20] [Technical]** Exact CSP directive set — especially
  `connect-src` entries for Reown relays and `script-src` inlines
  Next.js 16 emits in the static output.
- **[Affects R23] [Technical]** Which a11y tool drives the sweep —
  `@axe-core/cli`, Playwright + `@axe-core/playwright`, or manual. A
  single tool that can also be rerun in CI is preferable but not
  required for this pass.
- **[Affects SC-1] [Technical]** Whether the ~60s bootstrap budget
  holds with Envio catchup. Measure during planning.

## Next Steps

-> `/ce:plan docs/brainstorms/web-production-readiness-requirements.md` for
structured implementation planning.
