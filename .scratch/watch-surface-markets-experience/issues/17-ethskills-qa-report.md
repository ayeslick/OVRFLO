# Ticket 17 — ethskills:qa report

**Date:** 2026-08-13  
**App:** OVRFLO Markets (`web/`)  
**Reviewer context:** same session as ticket 16 (user sequenced U16 then U17). Ticket 15 finish review did not run.  
**Skills followed:** [ethskills qa](https://ethskills.com/qa/SKILL.md), [frontend-ux](https://ethskills.com/frontend-ux/SKILL.md), [CROPS](https://ethskills.com/crops/SKILL.md).  
**Not SE2:** Scaffold-ETH 2 items are mapped to the shipped stack (Next static export, wagmi v3, Reown AppKit) or marked N/A.

Ticket 15 verdict: **absent**. U14 Experience Review Gate gaps remain the visual starting list; they are not re-scored here.

---

## Ship-blocking (ethskills QA mapped)

| Item | Result | Evidence |
|---|---|---|
| Connect is a **button**, not a paragraph | **PASS** | `WalletButton` renders `CONNECT WALLET` (`web/components/WalletRuntime.tsx`). Inventory: `web/tests/inventory/watch-surface.test.tsx`. |
| Wrong network: Switch in the primary CTA slot | **PASS after fix** | WatchWrite early-returns to `SWITCH NETWORK`. Supply ReviewHandoff disables APPROVE/SUPPLY with `signingBlockedReason`. Borrow ReviewHandoff **did not** disable APPROVE STREAM when blocked — clickable on the wrong chain (handler also ungated). **Fixed in this ticket:** approve slot now matches supply; `onApprove` / `onBorrow` return on `wrongChain` / `!signingAllowed`. Test: `6b BORROW.APPROVE_STREAM` in `web/tests/inventory/borrow.test.tsx`. Writes still pin `chainId: configuredChainId` and identity-latch in `useWriteFlow`. |
| One button at a time (Connect → Network → Approve → Action) | **PASS** | Converter/StreamCreate stage to a single primary. Supply/Borrow ReviewHandoff shows APPROVE *or* SUPPLY/BORROW by checkpoint, never both. Disabled primaries stay visible with a reason (SETTLEMENT grammar). |
| Approve locked through click → hash → confirm | **PASS (executor)** / **gap vs ethskills cooldown** | Executor `isInFlight` covers connecting through confirming (`useTransactionExecutor`). Supply also keeps `approveSubmitting` + `approveCooldown`. Borrow/wrap/deposit rely on executor + local submitting flags; **no 4s cooldown** on borrow/converter. Not a double-broadcast of the same nonce if the executor stays in flight; cooldown-after-confirm is supply-only. **Owner-visible, not reopened as a rewrite.** |
| Contracts verified on explorer | **OWNER OPS** | Not a frontend unit. Factory footer links Etherscan when `NEXT_PUBLIC_OVRFLO_FACTORY` is a real address. Mainnet verification is Owner deploy work. |
| CROPS Review in this report | **PASS** | See below. |
| SE2 footer / title / README | **N/A PASS** | Not Scaffold-ETH 2. Title `OVRFLO Markets`. Footer is RISK + FACTORY. README is the protocol. |

**Verdict:** no remaining **code** ship-block from this audit after the borrow approve-gate fix. Ops and mobile WalletConnect deep-link are Owner-blocked (see below), not silently marked done.

---

## Should-fix (mapped)

| Item | Result | Evidence |
|---|---|---|
| Contract address on the page | **PASS (factory)** | `Footer` FACTORY ↗ when configured. Receipts show truncated lending operator. Not the SE2 `Address` blockie component. |
| Address **input** | **N/A** | No free-text address collection. Streams come from discovery. |
| USD next to every amount | **PRODUCT EXCEPTION** | `TokenUsdSwitch` is display-only; receipts stay token-exact (KTD14 / briefs). Ethskills “always show USD” would put USD on receipts — banned. Inventory product-truth: USD never in calldata. |
| OG image absolute URL | **PASS** | `metadataBase` from `NEXT_PUBLIC_SITE_ORIGIN` (fallback `https://overflow.finance`). `web/app/opengraph-image.tsx` is `force-static` 1200×630. `openGraph.images` is not hand-listed; Next wires the generated file against `metadataBase`. |
| pollingInterval 3000 | **PRODUCT EXCEPTION** | `READ_INTERVAL_MS = 15_000` is the named event-truth cadence (KTD9), not SE2’s 30s default. USD rides that cadence, not the 1 Hz tick. |
| RPC overrides + env set on host | **CODE PASS / OPS OPEN** | `createOrderedReadTransport` over `rpcUrls`; no bare `http()` fallback in `wagmi.ts`. Production CSP forbids localhost. Hosting env (`NEXT_PUBLIC_RPC_URL`, Reown project id, factory addresses) is Owner. |
| Favicon | **PASS** | Custom icons in `layout.tsx` metadata. |
| `--radius-field` pills | **N/A PASS** | Square kit; `border-radius: 0`. No DaisyUI. |
| Human-readable contract errors | **PASS** | `web/lib/errors.ts` enumerates ABI errors; missing copy fails tests. User rejection is classified, not dumped as hex. |
| Hardcoded dark wrapper | **N/A PASS** | Forced paper world (`--paper #FDFDFC`). No theme toggle. Intentional; not a DaisyUI bypass. |
| DaisyUI `loading` class on buttons | **N/A PASS** | Busy label is `SIGNING…` on `ActionButton`. |
| Phantom in RainbowKit | **N/A / UNVERIFIED** | Reown AppKit, not RainbowKit. Default AppKit wallet list is not clicked in this audit. **Owner:** confirm Phantom (and others) in the production AppKit modal. |
| Mobile WC deep-link (`writeAndOpen` + 2s) | **FAIL — OWNER-BLOCK** | No `openWallet` / scheme deep-link. In-app browsers (`window.ethereum`) work without it. WalletConnect-from-mobile-Safari is not implemented. **Do not claim mobile WC as a supported path until this exists.** Desktop injected wallets are the verified path. |
| WC session wallet detection | **FAIL with the deep-link item** | Same Owner-block. |

---

## Frontend Hardening gates (plan)

| Gate | Result |
|---|---|
| No third-party scripts / no CDN JS / lockfile bundle | **PASS (code)** | No `cdn.` / unpkg / jsdelivr in `web/`. Runtime deps are exact versions in `web/package.json`. `lint:deps` / `check-wagmi-dedupe.mjs` pins wagmi copies. Export grep is `verify-static-export.mjs` — not re-run here (needs production `next build`). |
| Pinned lockfile, wallet connectors as high-risk | **PASS (repo)** | `web/package-lock.json` committed. AppKit `1.8.23`, wagmi `3.7.3`, overrides for `@wagmi/core` / connectors. Advisory monitoring is Owner. |
| Strict CSP via `build-csp.mjs` → hash → `out/_headers` | **PASS (pipeline present)** | `web/scripts/build-csp.mjs`, `csp-hash-inline.mjs`, `verify-vercel-output.mjs`, tests in `web/tests/scripts/security-packaging.test.ts`. `next.config` `headers()` must stay a no-op under `output: "export"`. Production `connect-src` = RPC + WalletConnect/Reown. **Not re-run:** full `npm --prefix web run build` this session. |
| See-equals-sign | **PASS (tests)** | `web/tests/lib/actions.test.ts` — PERMISSION RECEIPT amount byte-equal to approve calldata; action args byte-equal to reviewed call. |
| Exact-amount approvals, visually distinct step | **PASS** | No `MaxUint256`. Permission receipt `MATCH EXACT`. Approve and action are separate checkpoints. Zero-first only on classified USDT-shaped revert (`useZeroFirstApprove`). |
| Ops: DNS lock, IPFS mirror, deploy keys, incident switch | **OWNER — not done** | Plan Tail ownership. Do not mark complete. |

---

## CROPS Review

**Chosen default:** Non-custodial Markets frontend. Users sign with their own wallet. Protocol admin is a timelocked multisig through `OVRFLOFactory`. Lending is loan-only against OVRFLO Streams (Sablier V2 v1.1 fork). No indexer; stream candidates from verified logs, truth from on-chain reads. Static export; CSP from the repo pipeline.

### Censorship Resistance — who can block, and the escape

- **Frontend host / DNS** can serve a different bundle (Badger-class). Escape: IPFS mirror per release (Owner, not built) + users can call contracts directly (ABI in repo, factory on Etherscan when verified).
- **RPC operator** can stall reads. Escape: `NEXT_PUBLIC_RPC_FALLBACK_URLS` ordered transport; failed reads classify unavailable, never zero. Historical log scan needs an archive-capable URL.
- **Reown / WalletConnect relay** can block new WalletConnect sessions. Injected wallets (`window.ethereum`) do not need the relay. Escape: a different wallet or direct contract use.
- **Factory owner (timelocked multisig)** can pause flash loans, change series approval, tick spacing, deposit limits. Cannot seize user ERC-20 or stream NFTs through the Markets UI. Pause/admin is disclosed on `/risk`.
- **No paymaster, bundler, or hosted indexer** in the shipped path. Ponder is historical, not a gate.

### Open Source and Free

- Protocol and Markets app are MIT in this repo. Users can fork and build the static export. Reown AppKit and wagmi are third-party source; they are lockfile-pinned, not self-hosted copies of the connector.
- Verified bytecode on Etherscan is Owner deploy work, not implied by this UI audit.

### Privacy

- Wallet address, balances, positions, and stream IDs are public chain data. The UI reads them via the configured RPC (RPC operator sees IP + the queries).
- Reown/WalletConnect sees connect metadata (`overflow.finance`, project id).
- No analytics SDK in `web/package.json` dependencies. No third-party font/CDN.
- USD path is Chainlink stETH/USD × wstETH `stEthPerToken` through the same RPC — no extra price-feed origin.

### Security — funds, upgrades, recovery

- **Custody:** none in the app. Approvals are exact amount (ERC-20) or single-stream NFT operator. Zero-first only after a classified revert.
- **Upgrades:** factory children are registered, not proxy-upgraded in this design. Sablier deployed instance is v1.1 (immutable ACL — `withdraw` is not public). Frontend bundle **is** upgradeable by whoever controls DNS/hosting.
- **Recovery:** user wallet. No social recovery, no embedded key.
- **Identity latch:** mid-flow wallet/chain change reports `identity_changed` and returns to review (`useWriteFlow`).
- **Stale signing:** `STALE — SIGNING DISABLED` when event truth is stale.

**Accepted compromises:** hosted frontend + RPC + Reown for WalletConnect; 15s read cadence; optional USD; no mobile WC deep-link yet; ticket 15 visual gaps still open.

**User escape:** disconnect; revoke approvals on-chain; call vault/lending/Sablier directly; self-host the static export from this repo.

---

## Defects this ticket

1. **Fixed:** Borrow APPROVE STREAM ignored `signingBlockedReason` and `onApprove`/`onBorrow` did not return on wrong chain / stale. Tests: `web/tests/inventory/borrow.test.tsx` `6b`.
2. **Owner-blocked from “mobile WC supported”:** no WalletConnect deep-link helper. Not a desktop injected-wallet defect.
3. **Owner-blocked ops:** DNS/IPFS/keys/incident switch, explorer verification of *this* deploy, production env vars on the host, AppKit wallet-list confirmation, production `next build` + seeded-fork E2E (Verification Contract — not re-run here).
4. **Not in scope (ticket 15):** gold-on-paper RollingNumber, claim-confirmed exits, repay wrap-shortfall, dual-role done-date, `SCHEDULES TICK LIVE` beside degraded events, keyboard-only / 360px visual pass.

No Solidity. No indexer. No health-factor UX.

---

## Attach with the PR

- This file
- `DESIGN.md` (ticket 16) and `.impeccable/design.json`
- Ticket 14 Experience Review Gate (stand-in until ticket 15 writes a verdict)
- `web/tests/inventory/PR-CHECKLIST.md`
