# Frontend decision map — OVRFLO

> **Superseded 2026-08 — v1-lite shipped; web rebuild is a separate plan.** `OVRFLOLending` was rewritten to the
> loan-only tick order book (`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`); the web app does not build
> against the new ABI and stays untouched until its own follow-on plan (plan Scope Boundaries). The general
> frontend-UX rules below remain valid orientation material, but any content describing the pre-rewrite
> OVRFLOLending ABI (liquidity positions, sale listings, loan pools) reflects the contract this frontend was
> built against, not the currently shipped contract.

Written 2026-07-28, alongside the audit remediation plan. This is orientation material, not a spec: it explains how dApp frontends are expected to work, where OVRFLO currently stands, and which decisions genuinely need a judgment call versus which are already settled by the standard.

Primary source for the conventions below: [ETHSKILLS](https://ethskills.com/SKILL.md) — specifically [`/frontend-ux`](https://ethskills.com/frontend-ux), [`/qa`](https://ethskills.com/qa), and [`/indexing`](https://ethskills.com/indexing). `AGENTS.md` names it as required reading, and it is the standard the 2026-07-28 audit judged against.

---

## Part 1 — The four rules that make a dApp frontend correct

Most of the audit's frontend findings are instances of four underlying rules. Understanding these four makes the individual findings self-explanatory.

### 1. One button, four states, in order

A dApp's primary action control is a **state machine**, not a button. It shows exactly one thing at a time, in this order:

```
Connect Wallet  →  Switch Network  →  Approve  →  Execute
```

The ordering is load-bearing. Network validation must come **before** the approval check, because an approval signed on the wrong chain is worthless and the user has no way to tell. Two states must never be visible at once — showing Approve and Execute together lets a user skip the approval and hit a revert they can't interpret.

**Where OVRFLO stands:** the Approve → Execute half is modelled correctly; the audit specifically praised it. The Switch Network state does not exist at any layer. That's finding H-2, and it's why the audit called it ship-blocking rather than a nice-to-have: reads are pinned to mainnet, so a user whose wallet is on Base sees a fully populated, apparently-live mainnet market table with every button enabled. At mainnet addresses on an L2 there is usually no contract code, so the call succeeds as a no-op, burns gas, and the UI reports it confirmed.

### 2. A button stays locked until the chain agrees it's done

There are two distinct windows where a button must be disabled, and covering only one of them is the classic bug:

| Window | From → to | What goes wrong if unguarded |
|---|---|---|
| **Submitting** | Click → transaction hash | Double-submit; two identical transactions |
| **Cooldown** | Confirmation → cache refresh | The button re-arms before the app has re-read state, so the UI still thinks work is pending |

That second window is the **confirmation-to-cache gap**. The chain has confirmed, but your app's cached view of allowances and balances hasn't caught up yet — typically a few seconds. During that gap a re-armed button looks legitimate and does real damage.

**Where OVRFLO stands:** the approval leg has a cooldown. The action leg has nothing — no form's disabled condition includes "this already confirmed," and no form clears its amount input on success. So after a successful deposit the screen simultaneously reads CONFIRMED, offers a CLOSE button, and leaves a live SUPPLY button above it with the original amount still filled in. One more click is a second deposit, a second Sablier stream, and a second fee. That's H-3.

The plan also adds a success confirmation (a toast or inline message), because a form that merely clears itself is indistinguishable from one that was never touched.

### 3. Every number a user reads has to be legible and honest

Three separate obligations sit under this:

- **Decimals.** Contracts store integers. `1500000000000000000` is 1.5 tokens at 18 decimals — and 1.5 *trillion* at 6. USDC uses 6. ETHSKILLS calls this the single most common "where did my money go" bug. OVRFLO hardcodes 18 everywhere and never reads `decimals()` from any token. That's safe today because wstETH is 18, and the project treats 18 as an invariant — which is why L-1 is a rejection rather than a fix. It stops being safe the moment a non-18 underlying is approved.
- **Rounding direction.** A balance display that rounds half-up can show more than the user holds, which then fails when they try to spend it. Always round *down* for balances. That's M-14.
- **Dollar context.** The convention is that token amounts carry a USD equivalent — `0.5 ETH (~$1,250.00)` — because users cannot judge risk in raw token units. OVRFLO deliberately doesn't do this, and the CSP even ships a CoinGecko allowance for a price fetch that was never built. That's L-8, and it's a real product decision rather than a defect: either implement it or remove the dead configuration.

### 4. Request volume is a correctness problem, not just a performance one

The convention is a 2–5 second polling interval and a dedicated production RPC, with an explicit watch for runaway request patterns — because rate-limiting doesn't degrade gracefully. A provider that starts returning 429s makes the app *wrong*, not slow: reads fail, the UI renders stale or empty state, and the user draws conclusions from it.

**Where OVRFLO stands:** this is finding H-4, and the numbers are large. Each `useLoanBook` mount expands to up to 2,500 individual contract reads (5 reads × 500 ids), and `PositionSummary` mounts one per lending market for any connected user. viem batches by calldata size, so 2,500 reads fragment into roughly 150 separate multicall requests. After every confirmed transaction the app invalidates its entire read cache and re-runs all of it, then does it twice more on 2- and 5-second timers. A `RepayForm` left open sustains ~1,000 reads every 2 seconds indefinitely.

The cost scales with **total protocol history**, not with what the user owns.

---

## Part 2 — Accessibility, in one paragraph each

These are the T1 findings. They are not subjective polish; each maps to a specific WCAG 2.2 AA criterion, which is the bar most teams commit to and the one the audit applied.

- **Unlabelled inputs (M-1).** A screen reader announces an input by its programmatic label. Every amount input in the app has none, so it announces as "edit text, blank" — the user cannot tell which field is which. This is the most severe accessibility finding and the cheapest to fix.
- **Keyboard model on the rate ladder (M-4).** An element with `role="radiogroup"` promises arrow-key navigation between options. The ladder claims the role and doesn't implement it, so keyboard users get a control that announces itself as navigable and isn't.
- **Focus trap (M-5).** While a modal is open, Tab must cycle within it. If focus escapes to the page behind, a keyboard or screen-reader user is interacting with content they can't see is there.
- **Target size (M-16).** Standalone controls need 24×24 CSS pixels. Two toggles compute to roughly 19px and 14px, and one of them is the only route to both WRAP and REPAY EARLY.
- **Contrast (M-10) and focus indicators (L-5).** Dimmed "settled" cards fall below the 4.5:1 minimum. The focus ring was deliberately removed for the design language and replaced with a border shift — that satisfies the AA criterion but is much weaker than a default ring; the fix is a thicker border on focus, keeping the aesthetic.
- **Motion (M-13).** Entrance animations must respect `prefers-reduced-motion`, which some users set for vestibular disorders.

None of these require design decisions. They have one correct implementation each.

---

## Part 3 — The indexer question

This is the live architectural decision, and it deserves the most space.

### The distinction that actually matters

The rule is **historical vs. current**, not "our data vs. someone else's":

- **Events are the historical record.** Every state change emits one. Indexing them offchain gives you cheap answers to "what happened" and "what exists."
- **Contract storage is the current source of truth.** Anything you act on is read live.

Reading history from contracts requires either an archive node or a scan, and scans are what break. Reading current state from an index means trusting a mirror.

The recommended pattern uses both, each for what it's good at:

```
Indexer   →  "positions 1, 47, and 812 belong to this address"     (discovery: what exists)
Contract  →  "position 812 holds 4.2 wstETH at 1050 bps"           (state: what it's worth)
```

### What OVRFLO does today

Two paths already exist, split by entity type rather than by this rule:

| Data | Source | Mechanism |
|---|---|---|
| Sablier streams held | Ponder | `fetchHeldStreamIds` over `@ponder/client` |
| Stream `withdrawable` | Contract | Overlaid on the indexer rows |
| Borrow demand | Ponder | `borrow_events`, from one `BorrowerLoanPoolCreated` handler |
| Liquidity positions, loans, pool shares | Contract | `enumerateIds(nextId, 500)` — walk ids 1…500, batch-read each |
| Ladder tick depth | Contract | Derived from those enumerated positions |

The stream path is close to correct — indexer for discovery, contract for the value that matters. The stream *fields* are not: `sender`, `asset`, `endTime`, `deposited`, and `withdrawn` all come from the indexer, and the app decides whether a stream belongs to a market using indexer-supplied values. That's M-9, and it means a compromised indexer can render positions and claimable balances that do not exist. The damage is bounded — contracts reject any resulting transaction — but it is a credible phishing surface.

The liquidity and loan path is the one that breaks. `enumerateIds` keeps ids **1 through 500** — the *oldest*. Once the protocol passes 501 positions, every subsequent position is invisible to the app forever and the window never advances. That is H-5, and it is worse than a display bug:

- Ladder depth is computed from the truncated set, so a tick funded only by post-500 positions shows zero depth
- The borrow form filters out zero-depth ticks, so that rate cannot be selected
- With no selectable tick, borrowing is dead — even though `gatherLiquidity` on-chain scans the full id space and would have found the liquidity
- Lenders who supplied after position 500 lose the WITHDRAW and ADJUST RATE buttons, which are the only in-app routes to their capital

The UI says `SHOWING FIRST 500 — DATA TRUNCATED`, which reads as a display limit rather than "your position and its withdraw button are gone."

### Why "Ponder only for Sablier streams" is half-right

The instinct being protected — the protocol owns the truth, not an offchain mirror — is correct and the architecture should preserve it. But it conflates two things:

1. **Trusting the indexer for values.** Correct to refuse. That's M-9's fix.
2. **Using the indexer for discovery.** Not the same thing. "Which ids exist" is a historical question about emitted events, and answering it by scanning on-chain is the pattern that produced both H-4 and H-5.

Event-sourced discovery keeps the protocol authoritative for every value while letting the event log answer the enumeration question. The indexer never becomes a source of truth — it becomes an index, which is what it is.

### If discovery stays fully on-chain

That is a legitimate choice; it trades request volume and a scan ceiling for zero new runtime dependency. It needs a different answer to H-4/H-5, and there are three:

| Option | What it does | Cost |
|---|---|---|
| **Per-user index onchain** | Add `lender → positionIds` and `borrower → loanIds` mappings to `OVRFLOLending`, so a user's own positions are one direct read with no scan | Solidity change, storage cost per position, and a re-audit |
| **Paginated enumeration** | Extend the bound-and-cursor approach already planned for `gatherLiquidity` to positions and loans; the client walks pages | Solidity change, but smaller; every position view pays a multi-page scan |
| **Newest-first window** | Flip `enumerateIds` to keep the newest 500 instead of the oldest | One line, no Solidity. The cliff still exists, just at a higher count, and old positions become the invisible ones |

The per-user index is the only one that removes the scan entirely for the case where the harm actually lands — a lender who cannot reach their own withdraw button.

---

## Part 4 — The static export constraint

`web` builds with `output: "export"`, meaning it compiles to static HTML/JS files with no server behind it. Two consequences that shaped audit findings:

- **No server means no secrets.** Anything the browser needs, the browser can read. So "add authentication to the indexer endpoint" cannot mean an API key in the client — it has to be enforced somewhere the client isn't, which means a proxy, an edge function, or provider-level controls.
- **No server means no per-request nonce.** The standard way to forbid inline scripts in a Content Security Policy is a nonce minted per request. Static export can't mint one. Next's App Router *does* emit inline scripts into every page, which is why the shipped CSP currently allows them. The only remaining route is hashing those scripts after the build and listing the hashes — which requires the CSP step to run *after* `next build`, not before it as it does now. That's finding M-17/R24.

---

## Part 5 — The decisions, and how they were settled

Most of the audit has one correct answer. Four did not. All four are now decided and recorded in the remediation plan.

1. **Discovery architecture → per-user index on the protocol.** `OVRFLOLending` gains `lenderPositionCount` / `lenderPositionAt` (and the borrower equivalent) as a counter plus index mapping, so a lender's own positions are a direct read with no scan. Market-wide ladder depth comes from the bounded, cursored `gatherLiquidity`. Ponder stays scoped to Sablier streams and borrow demand and never becomes load-bearing for protocol state. This moves H-4 and H-5 into the contract tranche.
2. **USD context → not built; dead configuration removed.** The CoinGecko CSP origin and the unused price-API entry come out, and the deviation from the dollar-context convention is recorded as deliberate. A price feed is a third-party runtime dependency whose staleness is its own hazard in a financial UI.
3. **Sale side → disclosure only.** One line on the supply form stating liquidity may be filled as a loan or an outright purchase. `PositionList` already renders held streams, so acquired streams already appear — that requirement is a regression guard, not new work. No provenance badge: a buyer knows they bought something.
4. **Tranche order → record, blockers, contracts, presentation, indexer trust.** Verification surfaces stay grouped so the re-audit stays confined to one tranche, but the groups run in order of consequence rather than leaving the contract fix last. This also resolves the dependency where the fill-path check needs the paginated gather.

Everything else in the audit — the accessibility set, the network gate, the confirmation re-arm, the reverted-approval handling, the CSP, the rounding, the copy consistency — has a single correct implementation and needs no decision, only work.

---

## Part 6 — The deploy path

The audit reviewed the application, not the pipeline. These come from [ETHSKILLS `/frontend-playbook`](https://ethskills.com/frontend-playbook/SKILL.md) and are recorded in the plan under "Deferred to deployment," because each fails silently rather than loudly.

- **Clear build artifacts before every production build.** A stale `out/` directory publishes old code with no error and no warning. The playbook calls this the single most common static-deploy failure. The tell is that the content hash doesn't change after a deploy that should have changed it.
- **Trailing slashes are deploy-target-dependent.** IPFS gateways don't resolve bare filenames, so `/markets` has to become `/markets/index.html` — which is what `trailingSlash: true` does. `web/next.config.ts` sets `output: "export"` without it. That's correct for Vercel and wrong for IPFS, and `scripts/build-csp.mjs` emits both a Vercel config *and* a `public/_headers` file (a Netlify/Cloudflare convention), so the intended target isn't recorded anywhere. Worth pinning down before the first deploy.
- **Never ship a public RPC in production**, and never let an API key reach a config file that gets committed. OVRFLO's root `.env` holds only `MAINNET_RPC_URL` — an RPC endpoint, not a signing key — and it's gitignored and absent from history, which is why L-9 grades as hygiene rather than exposure. The remaining exposure is one `git add -f` away, which is why the plan still relocates it.
- **Manual browser walkthrough before shipping.** Render, tab title, wallet connect, network switch prompt *and* execution, approve/action flow, rejected-transaction handling, and OG unfurl. Two of those — the network switch and the post-confirmation state — are exactly the paths H-2 and H-3 leave broken, which is why a manual pass catches them and the existing 313-test suite does not.
- **Event monitoring is a production-readiness assumption.** [ETHSKILLS `/ship`](https://ethskills.com/ship/SKILL.md) lists it alongside multisig ownership and an independent audit. OVRFLO has the multisig and the audit; nothing in the repo indicates monitoring.

One thing worth noting from `/ship` for context rather than action: it suggests a lending or vault app needs 0–1 contracts, and OVRFLO has four. That's a deliberate architecture — a vault, a token, a lending market, and a factory, each with a distinct owner and lifecycle — not scope creep. It's flagged here only so the comparison doesn't surprise you if you read that page cold.
