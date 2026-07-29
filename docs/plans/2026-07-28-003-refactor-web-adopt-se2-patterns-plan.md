---
title: "Adopt Scaffold-ETH 2 Frontend Patterns - Plan"
type: refactor
date: 2026-07-28
topic: web-adopt-se2-patterns
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Adopt Scaffold-ETH 2 Frontend Patterns - Plan

## Goal Capsule

- **Objective:** Close the specific gaps between OVRFLO's frontend and Scaffold-ETH 2's, take SE2's supply-chain and wallet-safety practices, and explicitly reject the rest — without touching the design system.
- **Product authority:** Scaffold-ETH 2 at commit `78ed3e8` and the extracted `@scaffold-ui/*` packages, read directly. ETHSKILLS `/frontend-ux`, `/qa`, `/indexing`, `/wallets` for the conventions.
- **Execution profile:** code — TypeScript/React in `web/`, plus repo-level dependency and deploy-key configuration. No Solidity, no Ponder changes.
- **Stop conditions:** Each requirement below has landed with tests; `npm --prefix web run test` green; no visual change to any screen.
- **Open blockers:** none.

---

## Product Contract

### Summary

Adopt from Scaffold-ETH 2 the things OVRFLO lacks — pre-flight transaction simulation, chain-pinned writes, transport fallback, scoped cache invalidation, a supply-chain install gate, and an encrypted deploy key — and explicitly reject the rest, including every input component. This is additive to the logic layer. Nothing in `DESIGN.md`, `globals.css`, or any component's visual output changes, and all accessibility work remains OVRFLO's own because SE2 has none to give.

### Problem Frame

The 2026-07-28 audit produced a large set of frontend findings, which invites the conclusion that the frontend was built wrong and should be rebuilt on a framework. Reading Scaffold-ETH 2's source does not support that conclusion, and reading its extracted UI packages actively contradicts it.

OVRFLO's logic layer is ahead of SE2's in four measurable ways. SE2 has **no post-write cache invalidation at all** — it relies on a per-block `invalidateQueries` subscription, so the confirmation-to-cache gap the ETHSKILLS QA checklist calls ship-blocking is unfixed upstream. SE2's `QueryClient` sets no `staleTime`. SE2's error handling passes viem's English through, where `web/lib/errors.ts` maps roughly forty protocol reverts to product copy. And SE2 has **no Content Security Policy anywhere** — no `middleware.ts`, no headers config, a `vercel.json` containing only an install command — where OVRFLO generates one at build time.

Most decisively: a complete grep of the extracted `@scaffold-ui` packages for accessibility attributes returns **zero** `aria-label`, `aria-invalid`, `aria-live`, `role`, `<label>`, or `onKeyDown`. The audit's accessibility findings cannot be closed by adopting SE2's components; adopting them would move OVRFLO backwards. Worse for the specific case, `EtherInput` is uncontrolled with no way for a parent to reset it — the exact capability H-3 requires when clearing an amount field after a confirmed transaction.

What remains worth taking is narrower than expected, and most of it is not UI at all.

### Key Decisions

- **The frontend is not rebuilt.** Adoption is additive and scoped to named gaps. *(session-settled: user-directed — the user offered to discard the frontend outside design; reading SE2's source showed the existing logic layer is ahead in post-write invalidation, staleness config, revert copy, and CSP, so a rebuild would trade those away.)*

- **No SE2 or `@scaffold-ui` component is adopted — only headless hooks.** The components carry no accessibility attributes and `EtherInput` cannot be reset by its parent. Logic hooks are taken where they earn it; all markup and all accessibility remain OVRFLO's.

- **Accessibility is entirely OVRFLO's own work.** No part of the audit's accessibility set is addressed by this plan. It stays in the remediation plan's presentation tranche, and SE2 offers no shortcut.

- **`useScaffoldEventHistory` is rejected.** It is deprecated upstream, directing production users to an indexer, and its chunking walks 500-block batches serially — one request per React render.

- **SE2's contract registry is rejected.** `wagmi generate` already provides typed ABIs, which is the better half of that trade.

- **SE2's invalidation model is adopted in shape but inverted in direction.** SE2 invalidates per-query-key on every block and never on write; OVRFLO invalidates everything on write and never per block. The target is SE2's scoping applied to OVRFLO's trigger.

- **The spot-AMM price feed is rejected outright.** `useFetchNativeCurrencyPrice` reads Uniswap V2 reserves with no TWAP, no staleness bound, and no sanity range, and that number drives `EtherInput`'s USD mode — so a user typing a dollar amount gets a quantity derived from a flash-loan-manipulable spot price. This independently validates the decision not to build USD context.

### Requirements

**Transaction safety**

- R1. Every contract write simulates against current chain state before the wallet is asked to sign, and a simulated revert surfaces the mapped human message rather than advancing to the signature request.
- R2. Simulation failure is distinguishable from user rejection and from a post-signature revert, so the three produce different messages.
- R3. Simulation can be bypassed per call site where a pre-flight would be misleading.
- R4. Every write names its expected chain at submit time, so a wallet that switched networks between render and click cannot broadcast to the wrong chain.
- R5. A contract address is confirmed to hold bytecode on the connected chain before any write targeting it is enabled.

**RPC reliability**

- R6. The read transport is a prioritised fallback list rather than a single endpoint, so one provider rate-limiting or failing does not take the app down.
- R7. Transport priority is explicit and configuration-driven, with an operator-supplied endpoint taking precedence.
- R8. Request batching is enabled on the transport so independent reads issued in the same tick coalesce.

**Cache correctness**

- R9. Cache invalidation after a confirmed write is scoped to the contracts and query keys that transaction touched, replacing the current whole-namespace invalidation.
- R10. A confirmed write invalidates its affected keys immediately rather than waiting for a polled block.

**Input handling**

- R11. Amount inputs share one parsing implementation, so the five call sites stop diverging.
- R12. Amount inputs accept pasted values containing thousands separators and surrounding whitespace rather than silently rejecting the keystroke.
- R13. Amount inputs reject negative values.
- R14. Any amount an input produces is parsed in fixed-point arithmetic throughout, never through a floating-point intermediate.
- R15. Every amount input can be cleared programmatically by its parent, so a confirmed transaction can reset the form.

**Supply chain and deploy safety**

- R16. Dependency installs refuse package versions published within a recent minimum age, with an explicit allowlist for first-party exceptions.
- R17. The libraries that construct and sign transactions are pinned to exact versions; other dependencies may use ranges.
- R18. CI workflow actions are pinned to commit SHAs rather than mutable tags or branches.
- R19. The production deployment key is stored encrypted and decrypted only at deploy time, never present as plaintext in an environment file.

**Untrusted data**

- R20. Strings read from arbitrary token contracts are length-capped and stripped of bidirectional-override and zero-width characters before display.

### Explicitly not adopted

Each was read and rejected for a stated reason, so a later reader does not re-derive it.

| Piece | Reason |
|---|---|
| Every `@scaffold-ui` component | Zero accessibility attributes across the package; `EtherInput` is uncontrolled and cannot be reset by its parent |
| `useFetchNativeCurrencyPrice` | Spot Uniswap V2 reserves with no TWAP or staleness bound, feeding a transaction amount |
| `useScaffoldEventHistory` | Deprecated upstream; serial 500-block batching is unusable at mainnet ranges |
| SE2 contract registry and `contract.ts` type machinery | `wagmi generate` already provides typed ABIs |
| `notification.tsx` | DaisyUI and Heroicons throughout; only the five-method surface is worth keeping |
| `getParsedError` | `web/lib/errors.ts` is strictly better — protocol reverts mapped to product copy |
| `useTransactor` lifecycle | `useWriteFlow` already covers it, including on-chain revert detection |
| RainbowKit connect button | OVRFLO is on Reown AppKit |
| `deepParseValues` | Heuristic retyping of user input with no reference to the ABI type of the field |
| Brute-force ABI matching in `decodeTxData` | First ABI that decodes wins; 4-byte selector collisions are cheap to construct |
| Committed default API keys | SE2 ships working shared Alchemy and WalletConnect credentials in git |
| `ignoreBuildErrors` / the `vercel:yolo` script | A one-command path to deploying code that does not typecheck |
| `useFetchBlocks`, `useContractLogs` | Local block explorer, hardcoded Hardhat WebSocket |
| SE2's wrong-network presentation | Header dropdown only, which the ETHSKILLS QA checklist calls insufficient |
| ENS normalisation guidance | OVRFLO renders no ENS names; not applicable |

### Where OVRFLO is already ahead

Recorded so a future reader does not import a regression.

- Post-write cache invalidation exists here and does not exist in SE2 at all.
- `staleTime: 10_000` is set; SE2 leaves it at zero.
- `web/lib/errors.ts` maps protocol reverts to product copy; SE2 passes viem's English through.
- A Content Security Policy is generated at build; SE2 has none anywhere.
- On-chain revert is read from `receipt.status`, with the reasoning written up in `docs/solutions/`.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given a supply that would revert because liquidity changed since the quote, when the user submits, then the mapped message appears and no signature is requested.
- AE2. **Covers R2.** Given a user who rejects the wallet prompt, when the flow handles it, then the message reads as a cancellation rather than a failure.
- AE3. **Covers R4.** Given a wallet that switches to another chain after the page renders, when the user submits, then the write does not broadcast to that chain.
- AE4. **Covers R6.** Given the primary RPC returning 429, when the market table loads, then reads succeed through the fallback endpoint.
- AE5. **Covers R9, R10.** Given a confirmed deposit, when the cache invalidates, then only that market's reads refetch and the balance updates without waiting for a polled block.
- AE6. **Covers R12.** Given a user pastes `1,234.56` into an amount field, when the input handles it, then the value is accepted as 1234.56 rather than silently discarded.
- AE7. **Covers R15.** Given a confirmed transaction, when the form resets, then the amount field is visibly empty.
- AE8. **Covers R20.** Given a token whose `symbol()` contains a bidirectional override character, when it renders, then the override is stripped and the displayed text reads in the expected direction.

### Success Criteria

| Area | Gate |
|---|---|
| Transaction safety | Tests assert no signature is requested on simulation failure, and that a write carries its expected chain |
| RPC reliability | A test asserts reads succeed when the first transport errors |
| Cache correctness | A test asserts an unrelated market's queries are not invalidated by a write |
| Input handling | Tests cover paste with separators, negative rejection, and programmatic clear |
| Supply chain | Install fails on a package version newer than the age gate; CI actions resolve to SHAs |

Additionally: `web/app/globals.css` is unmodified and `DESIGN.md` needs no amendment.

### Dependencies / Assumptions

- OVRFLO is on wagmi 3.7.3 and viem 2.55.5, so `simulateContract`, `fallback`, transport batching, and per-write `chainId` are available without an upgrade.
- Reown AppKit owns connector configuration, so transport changes apply to the `WagmiAdapter` transports map rather than a bare `createConfig`. The separate E2E `createConfig` in `web/lib/wagmi.ts` needs the same treatment or an explicit exemption.
- Markets are admin-approved through the factory, so R20's threat model is a compromised or careless approval rather than an open token list — which lowers its severity without removing it.
- `script/SeedDevnet.s.sol` and `script/seed-local.sh` read `PRIVATE_KEY` from the environment. R19 targets the production deploy path only; the local seeding path uses a well-known Anvil key and is out of scope.
- SE2 was read at commit `78ed3e8`; `@scaffold-ui/*` was read from `main` while SE2 pins `0.1.12` / `0.1.8`, so minor drift is possible.

### Outstanding Questions

**Deferred to planning**

- Whether R9's scoping is expressed as an explicit key list per write, or derived from the contract address the write targeted.
- Whether the R6 fallback list includes a public endpoint, given the ETHSKILLS rule against shipping public RPCs in production.
- Whether R11's shared parser is written fresh or built on `@scaffold-ui/hooks`'s `useEtherInput`, given that hook's own regex accepts negatives and its USD path uses floating-point division.
- Which package manager gate implements R16, since the repo uses npm rather than yarn 4.

### Sources / Research

- `docs/frontend-decision-map.md` — the conventions and where OVRFLO stands.
- Scaffold-ETH 2 at `78ed3e8`, `packages/nextjs/{hooks,components,services,utils}/`, plus `.yarnrc.yml`, `next.config.ts`, and the hardhat account scripts.
- `github.com/scaffold-eth/scaffold-ui`, `packages/{components,hooks,debug-contracts}/src`.
- `web/lib/wagmi.ts`, `web/lib/errors.ts`, `web/hooks/useWriteFlow.ts`, `web/hooks/useMarketSymbols.ts` — the OVRFLO side of each comparison.
- ETHSKILLS `/frontend-ux` Rule 5, `/qa`, `/wallets`.
