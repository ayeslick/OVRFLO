# OVRFLO Streams

**Authoritative plan:** `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`

**Objective:** Replace the canonical Sablier v1.1 deployment with OVRFLO Streams — a separate GPL fork of Sablier v2-core v1.1.2, consumed by address the same way Sablier is consumed today. Deployed logic changes in exactly three ways: ERC721 becomes ERC721Enumerable, the NFT descriptor becomes an on-chain ledger card, and `create*` admits only a registered OVRFLO vault. Then rebind OVRFLO, OVRFLOLending, seeding, audit docs, and Markets discovery to that deployment.

**Tickets:** `.scratch/ovrflo-streams/issues/` (01–10). This directory is the campaign tracker, the same shape as `.scratch/watch-surface-markets-experience/` and `.scratch/lending-v1-lite/`. Do not open GitHub issues unless the owner asks. Each ticket already carries the `ready-for-agent` label.

Work the frontier: any ticket whose blockers are done. **01–10** are resolved. Campaign branch `feat/u5-main-repo-rebind` is at `3373cfb`. One review is in progress over that branch vs `main`.

**Repos:** Two. Tickets **01–04** land in the sibling fork repo `OVRFLO-Streams` (GPL). Tickets **05–10** land in this repo (MIT). This repo never compiles the fork.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run the whole plan in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit. It must read Required reading before writing.
5. **Onboarding (first ticket a given coder runs — usually 02):** also read `docs/agents/onboarding.md` (**Before writing code** first), `CONCEPTS.md` "OVRFLO Stream" / "OVRFLO Streams (layer)" **and then ignore the stale sentences** (rebrand + `setMinter` — ticket 07 rewrites them; the plan wins until then), `docs/audit/sablier-interface-contract.md` (v1.1 ACL), and `docs/audit/rejected-findings-record.md` (third-party withdraw disproof). Every Solidity ticket: `BASE_SECURITY.md`, `docs/solutions/patterns/solidity-implementation-discipline.md` (Sequence 6–9), ETHSKILLS, `docs/solutions/patterns/ovrflo-coding-standard.md`, `docs/solutions/patterns/ovrflo-style-guide.md`. Every `web/` ticket: `docs/solutions/patterns/ovrflo-web-standard.md`, `docs/maps/SCHEMAS.md` §4, and the frontend-ux / frontend-playbook branches of ETHSKILLS.
6. **The plan is the single decision authority.** Search it before assuming anything is open. If something is not pinned, STOP and surface it. Do not decide locally. Do not re-litigate session-settled KTDs, OQ4, or OQ5. Each ticket copies naming, R17, R19, and do-nots so a coder who has not read the whole plan still cannot invent `setMinter` or skip completing-`repay` burn.
7. Before writing, run a **mandatory reuse audit** and a **mandatory unit-boundary reconciliation** (what this ticket owns vs later tickets). Do not edit the plan file while implementing.
8. **Intent record — before the first code write.** Follow **Intent record** below. Do not start implementation until that record is in the chat.
9. Honor stop conditions: if the v1.1 withdraw ACL cannot be preserved byte-for-byte, if Enumerable changes withdraw/transfer semantics, or if a fork deployable cannot fit EIP-170 under the profile that deploys it — surface and stop rather than adapt.
10. When acceptance checkboxes are done: fill **Final diff** on the ticket, set `Status: resolved`, commit (use **commit-tree plumbing** — never bare `git commit` from the agent), stop.
11. Next ticket → new chat again.

### Intent record (every ticket, including docs and tests)

Do not bury this in Required reading. Do it in the chat **before** the first code write.

Sources: `docs/agents/onboarding.md` § Before writing code; `docs/solutions/patterns/solidity-implementation-discipline.md` Sequence 6–9; `docs/maps/SCHEMAS.md` §4.

1. **Before code.** Post in the session: assumptions; predicted blast radius (files and callers); the verification that will fail if this ticket is wrong; what this ticket owns vs later tickets. Tickets **08** and **09** also write `.scratch/decisions/YYYY-MM-DD-*.yaml` from `.scratch/decisions/template.yaml`. Author this record *before* the code. Do not reconstruct it afterward and present it as pre-authored intent.
2. **During code.** If the work disagrees with the plan, STOP when the choice is unpinned. When a deviation is forced, write it under **Deviations from the plan** on the ticket, with why. Do not edit the plan. Do not silently change the plan in code.
3. **After verification, before `Status: resolved`.** Run `git diff --stat`. Fill **Final diff** on the ticket: predicted blast radius, actual file list, misses. A miss is a `docs/solutions/` learning candidate. Scratch YAML `diff_hints` names where a reviewer looks first.

### Parallel start

After **01** (already resolved): **02** and **03** in parallel. **04** waits on both. **05** waits on **04**. After **05**: **06**, **07**, and **08** may proceed in parallel (**08** unit tests do not need seed; R15 env wiring waits on **06**). **09** waits on **08**. **10** waits on **09**.

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Edit the plan file while implementing
- Compile the fork inside this OVRFLO repo, add it as a submodule, or `vm.etch` fork bytecode (constructor would not run)
- Rename Solidity identifiers in either repo (`SablierV2LockupLinear`, `sablierLL`, `SablierMismatch`, `SABLIER_LOCKUP_ADDRESS`, `MockSablier` stay)
- Invent a Solidity contract named `OVRFLOStream` or `OVRFLOStreamComptroller`. `OVRFLOStream` is the deployed ERC721 identity only. The lockup Solidity name is `SablierV2LockupLinear`. The comptroller Solidity name is `SablierV2Comptroller`. The one new Solidity name is `OVRFLOStreamDescriptor`
- Add `setMinter`. The mint gate is `ovrfloInfo(msg.sender)` treasury != 0
- Advertise `IERC4906` in `supportsInterface` (OQ5 — v1.1 does not)
- Re-check `stream.factory()` / `stream.admin()` / `comptroller.admin()` inside `registerLending`. Those checks live on `setOvrfloStream` only
- Run R17 burn on `close` only. A completing `repay` must dispose too
- Add `ovrfloStream()` on the vault. The vault getter stays `sablierLL()`
- Pass the Safe or the deployer as `initialAdmin` on the lockup or the comptroller. Production and seed pass the factory
- Run `forge script --broadcast` against local Anvil (critical pattern #2). Use `forge create` + `cast send` / `script/seed-local.sh`
- Run `FOUNDRY_PROFILE=invariant` (500 runs / depth 40). Default `[invariant]` (25 / 10) is the campaign gate
- Keep log-scan discovery as a fallback
- Use `git commit` from the agent (Cursor injects `Co-authored-by`); use write-tree / commit-tree / update-ref
- Start coding before the intent record is in the chat
- Reconstruct an intent record after the code exists and present it as pre-authored
- Edit the plan to hide a deviation; log the deviation on the ticket instead

---

## Ticket map

| # | Title | Plan units | Repo | Blocked by |
|---|---|---|---|---|
| 01 | Fork repo bring-up | U1 | `OVRFLO-Streams` | — (resolved) |
| 02 | ERC721Enumerable + mint gate | U2 | `OVRFLO-Streams` | 01 |
| 03 | Ledger-card descriptor | U3 | `OVRFLO-Streams` | 01 |
| 04 | Fork deploy wiring | U4 | `OVRFLO-Streams` | 02, 03 |
| 05 | Main-repo rebind | U5 | OVRFLO | 04 |
| 06 | Seeding + fork tests | U6 | OVRFLO | 05 |
| 07 | Docs and audit rebind | U7 | OVRFLO | 05 |
| 08 | Discovery swap | U8 | OVRFLO | 05 |
| 09 | Watch surface card and rows | U9 | OVRFLO | 08, 05 |
| 10 | E2E streams coverage | U10 | OVRFLO | 09 |

```
01 (done) ──┬── 02 ──┐
            └── 03 ──┴── 04 ── 05 ──┬── 06
                                    ├── 07
                                    └── 08 ── 09 ── 10
```

---

## Seams (do not invent new ones)

1. **Fork repo `OVRFLO-Streams`.** Separate project, same relationship this repo has to canonical Sablier today. Compile and deploy only there. This repo never links it.
2. **`interfaces/ISablierV2LockupLinear.sol`.** The only compile-time contract this repo has with the fork. Keep the path and the name. Add members. Do not rename.
3. **Factory `ovrfloStream` / `setOvrfloStream`.** One-shot admission of the canonical lockup. `registerOvrflo` / `registerLending` check the candidate binds that address. They do not re-verify `factory()` / `admin()`.
4. **Lending settlement.** `close`, and `repay` when remaining is zero, dispose of the NFT (burn if empty, else return). `claim` can empty the stream while the loan stays open.
5. **`useStreams`.** Held-stream discovery is Enumerable (`balanceOf` + `tokensOfOwnerIn` + batched state). Log-scan modules are deleted.
6. **`StreamDetail`.** Markets paints the ledger card in HTML from already-hydrated stream state. It does not paint from `tokenURI`.

---

## Authority (do not invent)

When sources disagree, the higher one wins:

1. The plan: `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
2. `docs/solutions/patterns/ovrflo-critical-patterns.md`
3. Minimality ladder in `docs/solutions/patterns/solidity-implementation-discipline.md`
4. Frontend: `docs/solutions/patterns/ovrflo-web-standard.md`
5. Live contracts in `src/` — never a stale glossary paraphrase

`CONCEPTS.md` currently says the fork rebrands identifiers and uses a minter slot. **That paragraph is wrong.** The plan (R1, R9, R2b) wins. Ticket 07 rewrites the glossary. Do not follow the stale CONCEPTS text while implementing 02–06.

---

## Problem Statement

The stream layer is still the canonical Sablier v1.1 contract at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. Sablier Labs is winding protocol work down. Markets discovers held streams by log-scanning, which is the discovery path that fights the browser. The NFT art is Sablier's, not OVRFLO's instrument.

A depositor, a borrower, and a Markets user need one owned stream layer: indexerless held-stream lists, OVRFLO ledger-card art in the wallet and in Markets, and no remaining dependency on Sablier's deployment.

## Solution

Ship a GPL fork of Sablier v2-core v1.1.2 in its own repo. Keep upstream Solidity names so `git diff v1.1.2` stays the audit surface. Change deployed logic in three places only. Bind every OVRFLO vault and lending market to that one deployment through the factory. Delete log-scan discovery. Paint the ledger card in Markets HTML from hydrated state. Keep the v1.1 withdraw ACL byte-for-byte.

## User Stories

1. As a depositor, I want `OVRFLO.deposit` to mint an OVRFLO Stream NFT, so that the PT discount still streams to me.
2. As a depositor, I want that NFT's wallet name to read `OVRFLO Stream` / `OVRFLOStream`, so that I do not see Sablier branding.
3. As a depositor, I want `tokenURI` to show a still ledger card, so that a wallet and a marketplace show OVRFLO's instrument.
4. As a Markets user, I want the Streams lens to list every live stream I hold without an indexer, so that discovery works in the browser.
5. As a Markets user, I want selecting a row to paint that ledger card in HTML, so that I can read percentage, amounts, rate, end date, and status from hydrated state.
6. As a Markets user, I want a CSS light band on a streaming bar and none on settled or depleted bars, so that motion exists only where value is still moving.
7. As a Markets user, I want empty streams hidden, so that the list is live instruments only.
8. As a Markets user, I want the book to go unavailable — never partial, never fake-empty — when the id count exceeds `MAX_ENUMERATION_IDS` (500), so that I do not act on a truncated financial list.
9. As a borrower, I want to pledge a held stream and see it leave Streams and appear as a loan, so that I am not shown the same instrument twice.
10. As a borrower, I want a full-value close to burn a depleted stream, so that a dead NFT does not sit in my wallet list.
11. As a borrower, I want a completing repay after lenders have harvested the stream to burn that depleted NFT too, so that repay is not a back door that returns junk.
12. As a borrower, I want a residual stream returned live, so that I can re-pledge or hold it.
13. As a borrower, I want settlement money movement to succeed even if burn reverts, so that disposal never bricks close or repay.
14. As a lender, I want `claim` to keep harvesting an open loan's stream, so that I am paid without waiting for close.
15. As a third party, I want `withdraw` to revert unless I am sender, NFT owner, or approved operator, so that the twice-rejected withdrawal finding stays false.
16. As the Safe, I want the factory to be `initialAdmin` on the lockup and the comptroller, so that I never call those contracts directly.
17. As the Safe, I want `setStreamNFTDescriptor` on the factory and no `transferAdmin` forwarder, so that art can swap and fees cannot turn on.
18. As the Safe, I want `setOvrfloStream` once, so that a wrong lockup cannot be adopted later.
19. As the Safe, I want `registerOvrflo` / `registerLending` to reject a candidate that is not bound to `factory.ovrfloStream()`, so that registration stays the admission gate.
20. As an unregistered address, I want every `create*` to revert, so that only a registered vault can mint.
21. As a registered vault, I want `deposit` → `create*` to mint, so that the production path works.
22. As an operator, I want seed and production to follow the same deploy order, so that Anvil and mainnet cannot drift.
23. As an operator, I want a missing stream address to fail boot loudly, so that Markets never renders a silent empty lens.
24. As a reviewer, I want `git diff v1.1.2 -- src/` plus the deviations table to list every fork change, so that I can confirm "v1.1.2 plus three changes" without reading the tree.
25. As a reviewer, I want audit docs to name the fork address and cite R3, so that checking canonical Sablier is not required to keep the ACL disproof.
26. As a frontend engineer, I want `SABLIER_LOCKUP_ADDRESS` to keep its name and change its value, so that a rename sweep does not land.
27. As a wallet, I want no SMIL and no CSS animation in `tokenURI`, so that the NFT image is still.
28. As a holder of a spoof NFT, I want it excluded from the Streams lens unless sender is a registered vault and asset is that vault's ovrfloToken, so that junk cannot look like collateral.

## Implementation Decisions

- Fork repo is a separate project. This repo does not compile it, vendor it, or choose its package manager (OQ4).
- Solidity names stay upstream in both repos (R1, R9). `OVRFLOStream` is deployed ERC721 identity (`name`/`symbol` only, set in ticket 03).
- Three deployed-logic changes only: Enumerable + `tokensOfOwnerIn`, ledger-card descriptor, `ovrfloInfo(msg.sender)` mint gate. No `setMinter`.
- LockupDynamic stays in the fork tree and is never deployed.
- Fork v1.1.2, never newer Lockup (public withdraw would resurrect the rejected finding).
- Factory is `initialAdmin` on lockup and comptroller. Fees at zero. Factory forwards only `setNFTDescriptor`. No `transferAdmin` forwarder.
- `setOvrfloStream` is `onlyOwner` and once. It checks `factory()`, `admin()`, and `comptroller.admin()`. `registerLending` does not repeat those checks.
- Vault stream binding becomes a constructor argument. Getter stays `sablierLL()`. Do not add `ovrfloStream()` on the vault.
- R17 disposal: after money movement on `close` and on `repay` when remaining is zero. Burn if empty; else return. Burn revert falls through to return. Emit `StreamDisposed` and keep `Closed`.
- This repo keeps `MockSablier` / `MockLendingSablier`. Real bytecode is proven in ticket 06, never via `vm.etch`.
- Three committed artifacts: lockup, comptroller, descriptor. GPL notices and provenance stamps on each.
- `IERC4906` stays unadvertised (OQ5).
- Discovery: `useBorrowerBook` staging. Hide empty rows. Ceiling `500n`. Poll `READ_INTERVAL_MS` (15s). Ticker is local clock.
- Do not delete `TouchedResource.stream.sablier`. Rebind `SABLIER_LOCKUP_ADDRESS`.
- `CONCEPTS.md` rewrite is ticket 07. Until then the plan wins over the glossary.

## Testing Decisions

- Test external behavior: ACL, enumeration, mint gate, registration errors, settlement disposal, discovery honesty, card paint.
- Do not test by echoing implementation arithmetic back at itself.
- Fork inherited suite is a **local-only** gate (UNLICENSED tests are not published). New R2/R2b/R4 tests use a standalone harness (R7b).
- This repo's unit/fuzz/invariant suites stay on the mock (ticket 05). Real fork bytecode: seed + `test/fork/*` (ticket 06).
- Invariant smoke only. Do not run `FOUNDRY_PROFILE=invariant` (500 runs, depth 40). Use the default `[invariant]` profile (25 runs, depth 10). This campaign is a drop-in stream fork. The three deployed-logic changes do not change vault or lending core product. Do not edit `foundry.toml` run counts. Log this scope on the ticket; do not edit the plan.
- Frontend: assert mocked wagmi hook options (no transport mock). Failed reads are `{status:"failure"}` entries (`web/tests/hooks/useLending.test.ts:8`), not rejected promises.
- E2E: `docs/agents/testing.md`. Every stream Given arranged outside the app write flow ends with `the frontend re-syncs with chain state`.
- `npm --prefix web run test` already runs `pretest`. Name `pretest` so `npx vitest` cannot skip SC11.

## Out of Scope

- LockupDynamic deployment
- Migration tooling off canonical Sablier (pre-launch swap)
- Indexers or log-scan fallback
- Marketplace art beyond the ledger card
- Vault logic beyond constructor rebind
- Tree-wide identifier rename
- `IERC4906` advertising
- Splitting ticket 05 or 08 (P2 notes stay deferred)
- SVG motion on `tokenURI` (later via descriptor swap)

## Further Notes

`PRODUCT.md` already names OVRFLO Streams. `CONCEPTS.md` does not yet match R1/R9/R2b. Ticket 07 is the glossary fix.

P2 notes left in the plan: ticket 05 is a large Phase B gate; ticket 08 also owns freshness. Do not split those tickets in this campaign.
