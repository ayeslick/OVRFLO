# Denomination switch, wrap reserve, and Default / Advanced product

**Authoritative plan:** `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

**First hop:** `docs/agents/system.md`. Then this spec's session rules. Then the ticket's plan unit. Do not reread the whole plan for a question the hop table already routes.

**Objective:** Switch the column to ovrfloToken denomination, extract wrap/unwrap into `OVRFLOReserve` via nested constructors, admit the column at the factory, remove PT flash, add the lending router hook, then replace the Markets product with the boards' `Default` / `Advanced` model over one canonical action runtime. CS5–CS7 add public-read resilience, a gated eth-compress evaluation, and classified web tooling.

**Tickets:** `.scratch/denomination-border-column/issues/` (01–26). Work the frontier: any ticket whose blockers are done. Do **one ticket per chat**.

**CS0** shipped on 2026-09-01 as its own two-line README commit; no ticket carries it. **CS4-U4** is split: ticket **17** ships composite recovery; ticket **18** ships Hosted Convert and per-underlying USD. Tickets **09** and **10** are CS2 and CS3 in this plan.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run the whole plan in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file. Do not claim a ticket whose Status is `needs-info`.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit; it must read Required reading before code. Tickets **01**, **23**, and **25** skip `/ce-work` (deletion, config printed in KD20, formatter output); their acceptance criteria are the checklist. Every Session prompt carries these `/ce-work` overrides, which win over the skill's defaults:
   - Branch: work on `ticket/<nn>` in this worktree. Do not create another branch or ask about branches.
   - Commits: plumbing bypass per `.cursor/rules/no-commit-attribution.mdc`. Never `git commit`.
   - Review: skip `ce-code-review` (it runs on the implementer's model). Dispatch one read-only reviewer subagent with the slug from § Model routing. Reviewers report; the ticket chat decides.
   - Shipping tail: no PR, no `ce-commit-push-pr`, no branding. Push the ticket branch and stop.
5. **The plan is the single decision authority for this campaign.** Search the hop table in `docs/agents/system.md` first. Then search Key Decisions, Implementation Units, Sweep Contracts, and the Verification Contract before assuming anything is open. If something genuinely is not pinned, STOP and surface it; do not decide locally. Do not re-litigate settled ground: `docs/audit/rejected-findings-record.md` and the plan's signed decisions are binding.
6. **Do not edit the plan file** while implementing. Log every deviation on the ticket with its reason.
7. Before the first code write, record intent (assumptions, predicted blast radius, verification). Solidity: Sequence 6 in `docs/solutions/patterns/solidity-implementation-discipline.md`. State-touching web: scratch YAML under `.scratch/decisions/` per `docs/maps/SCHEMAS.md` §4. Do not reconstruct the record afterward.
8. Before hand-writing production code, run a **mandatory reuse audit**. In the final report, list what was reused; if a new abstraction was necessary, state the concrete incompatibility that prevented reuse.
9. Before implementation, run a **mandatory unit-boundary reconciliation**: read this ticket, adjacent tickets, and the matching plan unit. State what this ticket owns, what a later ticket owns, and the seam. Do not perform a later unit's work early (recovery is 17; Hosted Convert and USD are 18; request-book UI is 19 after CS3).
10. **Test integrity is a hard requirement.** Named successor scenarios in the plan's Verification Contract item 7 are the accountability list. A test that would pass against a subtly wrong implementation is a defect.
11. When acceptance checkboxes are done: set `Status: resolved`, commit on the feature branch with **commit-tree plumbing** (never bare `git commit` from the agent), stop.
12. Next ticket → new chat again.

### Onboarding (first Solidity ticket for a given coder)

Read `docs/agents/onboarding.md`, `README.md` (Architecture), `CONCEPTS.md`, `BASE_SECURITY.md`, `VAULT_SECURITY.md`, `docs/solutions/patterns/solidity-implementation-discipline.md`, `docs/solutions/patterns/ovrflo-coding-standard.md`, `docs/solutions/patterns/ovrflo-style-guide.md`, `docs/solutions/patterns/ovrflo-critical-patterns.md`, and https://ethskills.com/SKILL.md.

### Onboarding (first web ticket for a given coder)

Read `PRODUCT.md`, `DESIGN.md`, `docs/solutions/patterns/ovrflo-web-standard.md`, `docs/maps/SCHEMAS.md` §4, and the ETHSKILLS frontend-ux / frontend-playbook branches. CS1-U7 and every CS4–CS7 ticket follow those docs.

### Parallel start

```
01 ── 02 ── 03 ── 04 ──┬── 05 ── 07 ── 08
                       │
                       └── 06 (deferred; owner start-OK; blocks nothing)
                                      08 ── 09 (CS2 flash mint)
                                      08 ── 10 (CS3 request book)

07 ── 11 ── 15 ── 16 ── 17 ── 18 (Hosted Convert + per-underlying USD)
                 │              └── 19 ── 20     (19 also waits on 10)
                 └── (11)────────────────┘

07 ── 12 ──┬── 13
           └── 14 ── 21 ── 22 (22 only if 21 evaluates)

08 + 13 + 14 + 18 + 20 + 21 ── 23 ── 24 ── 25 ── 26
```

- **01** can start immediately.
- **Parallel tickets use separate git worktrees.** Two chats must not share one checkout (pattern #24). For each ticket that runs beside another: `git worktree add ../OVRFLO-<nn> -b ticket/<nn> <campaign-branch>`, work there, then merge `ticket/<nn>` into the campaign branch on resolve and remove the worktree. Serial tickets may share the checkout.
- **05** runs after **04**. **06** is deferred (owner 2026-09-02): fuzz and invariant re-derivation runs after the feature tickets. Do not claim **06** until the owner records start-OK on it.
- **11** and **12** run in parallel after **07**. Do not wait for **08**.
- **13** and **14** run in parallel after **12**.
- **08** waits on **07** only; it no longer waits on **06**.
- **09** and **10** are ready-for-agent after **08**. Implement them from this plan. Do not mix them into CS1 commits.
- **18** is ready-for-agent after **17**. USD is a per-underlying recipe table (KD17). Launch ships the wstETH row. A missing row fails closed. Never reuse wstETH for another column.
- **17** must not wait on **18**. **19** and **20** must not wait on **18**.
- **22** exists only if **21** records `evaluate` and **22** then records final `adopt`. If **21** records `do not adopt`, mark **22** cancelled.
- **23** waits on CS1 docs (**08**), CS5 (**13**, **14**), CS4 web code (**18**, **20**), and the CS6 decision (**21**). **23** must not wait on **09**, **10**, or **22**. Reason: the formatting-only commit (**25**) and the parity ledger (**24**) must run over settled web code (plan CS7-U1 dependencies).
- Tickets **21** and **23** also wait for owner start-OK. Pins are already in KD19/KD20. Do not re-research pins.
- Ticket **26** is coordinator-executed, not a fresh-chat cheap-model ticket.

### Model routing (updated 2026-09-02; supersedes `ori-eval/routing-recommendation.md`)

All model slugs are available. Fable seats use `claude-fable-5-1-thinking-high` (2026-09-02): Anthropic lists Fable 5.1 at the same input/output price as Fable 5 with cache reads at one quarter, and 55.8% vs 42.0% on Terminal-Bench 4.0. The in-repo eval measured Fable 5; treat its pass rate as a floor for 5.1, not a measurement of it. The per-ticket chat is both orchestrator and implementer; it dispatches one read-only reviewer subagent and disposes the findings itself. Do not keep a standing orchestrator chat across tickets; context cost grows with every ticket. The main cost lever is the Required reading rule: read the named plan sections only, never the whole plan.

| Tickets | Implementer (UI pick for the chat) | Reviewer subagent (read-only) |
|---|---|---|
| 02, 03, 04, 06, 09, 10 (custody, admission, invariants, flash mint, request book) | `claude-fable-5-1-thinking-high` | `gpt-5.6-sol-medium`; second pass `cursor-grok-4.6-xhigh` on **02** and **04** only. Reviewers read https://ethskills.com/SKILL.md (security and audit branches) and `docs/audit/rejected-findings-record.md`, then use their own judgment. Do not use the `solidity-security-auditor` subagent or any other review persona. |
| 01, 05 (deletion, deploy scripts) | `cursor-grok-4.6-xhigh` | `gpt-5.6-sol-medium` |
| 17, 18 (recovery runtime, hosted response validation, USD execution bounds) | `claude-fable-5-1-thinking-high` | `gpt-5.6-sol-medium` |
| 07, 11, 12, 13, 14, 15, 16, 19, 20, 22, 24 (web bulk) | `cursor-grok-4.6-xhigh` | `gpt-5.6-sol-medium` |
| 21 (bench harness and measurement) | `gpt-5.6-sol-medium` | `cursor-grok-4.6-xhigh` |
| 23, 25 (config files printed in KD20; formatter output) | `composer-2.5-fast` | `gpt-5.6-sol-medium`, diff-only |
| 08 (docs) | `claude-fable-5-1-thinking-high` | `gpt-5.6-sol-medium` |
| 26 (compound) | coordinator chat, `claude-fable-5-1-thinking-high` | none |

Rules:

- The reviewer is a different model family from the implementer. Fable implements, GPT reviews; Grok implements, GPT reviews; GPT implements (21 only), Grok reviews.
- One reviewer per ticket. No panels. Two reviewers only on **02** and **04**.
- Reviewers report findings (severity, `file:line`, evidence, suggested fix). They do not edit, commit, or pick verdicts. The ticket chat decides.
- Prices are not pinned here. Check the Cursor pricing page before the first ticket. If Fable 5.1 high costs no more than Grok xhigh per request, put Fable on every implementer seat; the in-repo eval scored Fable higher on these briefs.

### Solidity verification (tickets 01–06)

Keep the clean `forge build` then `forge test` order. `forge fmt --check` must be clean.

**Fork-test skips are expected:** `test/fork/` suites self-skip without `MAINNET_RPC_URL`. Do not investigate the skips, set up an RPC, or write fork tests outside the ticket scope. If a ticket names a seed smoke and the RPC is missing, record an environment-gate result; never fake it. Never `forge script --broadcast` against local Anvil (critical pattern #2).

**Fuzz and invariant suites are out of scope until ticket 06 starts (owner 2026-09-02).** Plain `forge test` still compiles and runs `test/OVRFLOFuzz.t.sol`, `test/OVRFLOInvariant.t.sol`, `test/OVRFLOLendingInvariant.t.sol`, `test/OVRFLOWrapUnwrap.invariant.t.sol`, and the `test/fizz/` Foundry harness at the default profile (25 runs / depth 10); they must stay green. If this ticket's change breaks one of those files, make the minimum edit that restores compile and green: rename a call, retarget an address, drop an assertion about a function that no longer exists. Do not re-derive properties, add coverage, port a suite, recompute slot constants beyond what the golden forces, or verify GL-nn ids. Do not run `FOUNDRY_PROFILE=invariant`. Do not run the fizz harness (Echidna, Medusa, or `fizz-sync`). Log each such minimum edit on the ticket so 06 can find it.

**Storage goldens (tickets 02–05):** append new deployables to `CONTRACTS` in `tools/scripts/check-storage-layout.sh` before the first golden. Regenerate goldens **only** via `check-storage-layout.sh --write`. Hand-edited golden files are a logged deviation. Recompute raw-slot test constants from the regenerated lending golden; keep `exposed_epochState` cross-checks as the loud-failure guard.

**Web build is ticket 07's gate.** Tickets **02** and **03** change the vault and lending ABIs; the web call sites that break (`wrap`, `unwrap`, `wrappedUnderlying`, `borrow`) flip in **07**. Do not run or gate on `npm --prefix web run build` in **01–06**. The compile-coupled file edits named in CS1 U2 (wagmi config, `ovrfloReserveAbi` in the error union, invalidation keys) still land with **02**.

### Web verification (tickets 07, 11–25)

Run the gates the plan's Verification Contract names for that changeset. Do not mix CS4–CS7 work into CS1. Do not introduce an app server. Writes always reacquire a fresh wallet client and simulate the untransformed transaction.

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Edit the plan file, Key Decisions, or Sweep Contracts while implementing
- Touch `StreamPricing` math or `_fillTick` (stop condition (d))
- Extend the `OvrfloInfo` tuple or add `replaceReserve`
- Add `NEXT_PUBLIC_OVRFLO_RESERVE` (add it to the obsolete list instead)
- Add `supplyWithPermit` or `repayWithPermit` on the lending market
- Split `Default` and `Advanced` into two visual systems
- Use viem-dlc or eth-compress to transform wallet writes
- Let log-derived candidates gate, size, or authorize an action
- Apply the wstETH USD recipe to another column, or default a missing recipe to wstETH
- Invent destination paths or query keys outside the KD16 URL table; add redirects from pre-CS4 URL shapes; put Advanced in the URL
- Enable type-aware Oxlint or upgrade to TypeScript 7
- Run `npx ultracite init`, git-install eth-compress, or install unpublished `eth-compress@0.5.0`
- Spread Ultracite `core.ignorePatterns` (it drops `web/lib/generated.ts`)
- Implement ticket **09** or **10** before **08** is resolved
- Let the request book pick, search, or cap a tick; the borrower's stored `aprBps` is the only fill tick (KD14)
- Wrap core `borrow` in `try/catch` inside the request book; only `previewBorrow` is caught, and only `EmptyTick` / `BelowMinimum` rest a request (KD14 fill-or-rest)
- Read one `ovrfloToLending` per vault as the whole lending set in the web; enumerate `lendings(i)` so a replaced market's positions stay visible (KD7)
- Lower `LENDING_RUNTIME_CANARY` if the canary fails; drop the router hook and surface
- Use `git commit` from the agent (Cursor injects `Co-authored-by`); use write-tree / commit-tree / update-ref

---

## Ticket map

| # | Title | Plan units | Blocked by | Status at publish |
|---|---|---|---|---|
| 01 | Delete PT flash | CS1-U1 | — | resolved |
| 02 | Token, reserve, vault constructor chain | CS1-U2 | 01 | resolved |
| 03 | Lending asset switch and router hook | CS1-U3 | 02 | ready-for-agent |
| 04 | Factory registration, replaceLending, setLendingRouter | CS1-U4 | 03 | ready-for-agent |
| 05 | Deploy recipe and seed tooling | CS1-U5 | 04 | ready-for-agent |
| 06 | Invariant and fuzz re-derivation | CS1-U6 | 04, owner start-OK | ready-for-human (deferred 2026-09-02) |
| 07 | Web denomination sync | CS1-U7 | 05 | ready-for-agent |
| 08 | Docs sync | CS1-U8 | 07 | ready-for-agent |
| 09 | CS2: ERC-3156 flash mint | CS2-U1 | 08 | ready-for-agent |
| 10 | CS3: borrow request book | CS3-U1 | 08 | ready-for-agent |
| 11 | Shared visual system and Default / Advanced shell | CS4-U1 | 07 | ready-for-agent |
| 12 | Pin viem-dlc public-read transport | CS5-U1 | 07 | ready-for-agent |
| 13 | Bounded logs and progressive completeness | CS5-U2 | 12 | ready-for-agent |
| 14 | Deployless capability probes | CS5-U3 | 12 | ready-for-agent |
| 15 | Portfolio hub, collection, and detail routing | CS4-U2 | 11 | ready-for-agent |
| 16 | Self-Repaying Loan and Fixed Return create flows | CS4-U3 | 11, 15 | ready-for-agent |
| 17 | Composite recovery runtime | CS4-U4 recovery | 16 | ready-for-agent |
| 18 | Hosted Convert and USD execution bounds | CS4-U4 hosted/USD | 17 | ready-for-agent |
| 19 | Named request, waiting, transaction, and edge states | CS4-U5 | 10, 15, 16, 17 | ready-for-agent |
| 20 | Responsive, accessible, Advanced-parity proof | CS4-U6 | 11, 15, 16, 17, 19 | ready-for-agent |
| 21 | eth-compress benchmark and evaluate gate | CS6-U1 | 12, 14, owner start-OK | ready-for-agent |
| 22 | eth-compress read-only path with plain fallback | CS6-U2 | 21 (evaluate) | ready-for-agent |
| 23 | Add Ultracite, Oxlint, and Oxfmt commands | CS7-U1 | 08, 13, 14, 18, 20, 21, owner start-OK | ready-for-agent |
| 24 | Classify ESLint/Oxlint parity | CS7-U2 | 23 | ready-for-agent |
| 25 | Oxfmt formatting-only commit | CS7-U3 | 24 | ready-for-agent |
| 26 | Compound and codify | post-plan | 25 | ready-for-human |

---

## Authority (do not invent)

Start with `docs/agents/system.md`. When sources disagree, the higher one wins:

1. The plan's Key Decisions, Sweep Contracts (inherited CS1 rules 1–12 and AS1–AS10, plus CS6/CS7 rules 13–14), and Verification Contract.
2. Product truth: `PRODUCT.md`, `CONCEPTS.md`. CS4 `Default` information architecture follows `DESIGN.md`; the newest four boards are acceptance evidence only (AS1).
3. Contract truth: live `src/` as built after each ticket — never a doc's paraphrase of a prior architecture.
4. `docs/audit/rejected-findings-record.md` for findings already disproven.

Stop conditions in the plan Goal Capsule (a)–(p) remain binding. A hit is a stop, not a local workaround.

---

## Start authorization and remaining owner gates

Pins for CS6 and CS7 are in KD19 and KD20. Do not invent a substitute. Do not re-research pins.

- **Tickets 21 and 23:** do not start CS6 or CS7 code until the owner records start-OK on that ticket.
- **Ticket 06:** deferred 2026-09-02. Do not start fuzz or invariant re-derivation until the owner records start-OK on that ticket. Other tickets follow the "Fuzz and invariant suites" rule under Solidity verification.
- **Ticket 22:** runs only if ticket 21 recorded `evaluate`. Install only npm `eth-compress@0.4.0` per KD19. If artifacts fail, STOP. Do not git-install. Do not wait for `0.5.0`.
- **A later underlying:** add a reviewed USD recipe row (explorer verification, kind, heartbeat, share-rate) before USD display or USD submit for that column. Token-native flows do not wait. Do not copy the wstETH row.
