# 07 — Docs and audit rebind

**What to build:** Audit record, agent docs, x-ray, README, and `CONCEPTS.md` name the fork as the bound stream layer without losing Sablier v2-core v1.1.2 provenance. Rewrite the stale `CONCEPTS.md` paragraph that says identifiers were rebranded and minting uses one minter address — that paragraph is false under R1/R9/R2b.

**Repo:** this OVRFLO repo.

**Blocked by:** 05

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/07-docs-and-audit-rebind.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Do not edit the plan. Do not start U6/U8–U10 unless they are already resolved.
This is a documentation unit. Do not change Solidity or web/ except docs listed.
Before any writes, read Required reading and the plan sections: R1, R9, R11, R19,
SC12, SC13, ### U7, Definition of Done naming bullet.
CONCEPTS.md currently claims a tree-wide rebrand and setMinter. The plan wins.
Rewrite that entry to: upstream Solidity names stay; OVRFLOStream is deployed
ERC721 identity; mint gate is ovrfloInfo(msg.sender) treasury != 0; LockupDynamic
is not renamed and is never deployed.
R11 gate: docs/audit/ names the fork, states sablierLL no longer resolves to
0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9, and cites R3 for the ACL disproof.
INTENT RECORD (before the first code write): post assumptions, predicted
blast radius, and the verification that will prove this ticket. Log plan
deviations on this ticket with why; do not edit the plan. Before Status:
resolved, fill Final diff from git diff --stat vs that prediction. Do not
reconstruct the record afterward. See spec.md Intent record and
docs/agents/onboarding.md Before writing code.
After verification, mark ticket checkboxes done and set Status: resolved.
Commit with write-tree / commit-tree / update-ref. Never git commit.
```

**Required reading:**

- `.scratch/ovrflo-streams/spec.md` (Intent record)
- `docs/agents/onboarding.md` § Before writing code
- Plan R1, R8 (registration trust shift after KTD6), R9, R11, R19, SC12, SC13, ### U7
- `docs/audit/sablier-interface-contract.md` (S1–S5 preserve-exactly set)
- `docs/audit/rejected-findings-record.md` (third-party withdraw disproof; finding IDs collide — qualify by audit)
- `CONCEPTS.md` "OVRFLO Streams (layer)" and "Shipped discovery" entries (stale)
- `AGENTS.md` stream-layer facts
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **R1 / R9.** Docs must not tell an implementer to rename Solidity identifiers. `CONCEPTS.md` today says the opposite. Rewrite it.
- **R2b.** Mint gate is `ovrfloInfo(msg.sender)` treasury != 0. There is no minter slot and no `setMinter`. One lockup serves every registered vault.
- **R11.** Same ACL table. Provenance line: "fork of Sablier v2-core v1.1.2". State the address change: `sablierLL` no longer resolves to `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. Cite R3 for why the withdraw-ACL disproof still holds. A reviewer who checks canonical Sablier and lucks into the right answer has not followed evidence.
- **SC12.** Extend the preserve-exactly set from withdraw ACL alone to S1–S5 rows, including:
  - `createWithDurations` cliff encoding: vault `deposit` passes `durations.cliff: 0`; v1.1 stores `cliffTime == startTime`
  - consume-side `StreamPricing.requireEligible` (`CliffPresent` when `cliffTime != startTime`)
  - withdraw-hook branch predicate
  - `getStream`'s SETTLED `isCancelable` normalization
  - Do **not** treat `StreamPricing.sol:209` as create-side arithmetic
- **SC13.** Zero protocol fees are immutable by construction. Factory is admin. `Adminable` is one-step. Factory forwards `setNFTDescriptor` only. No `transferAdmin` forwarder. `setProtocolFee` / `setFlashFee` / `toggleFlashAsset` / `setComptroller` / `claimProtocolRevenues` cannot succeed. Do not undersell this as "policy". Do not add `execute`. Human control: factory is `Ownable2Step`, so a Safe rotation carries stream admin.
- **R8 trust shift.** After KTD6, matching audited vault bytecode no longer implies a correct stream binding. `registerOvrflo` / `registerLending` require the candidate binds `factory.ovrfloStream()`. `SablierMismatch` still proves vault and lending bind the same stream. The Safe still checks creation bytecode off-chain.
- **R19 rows.** `x-ray/entry-points.md` gains `setOvrfloStream` and `setStreamNFTDescriptor`. Other lockup/comptroller `onlyAdmin` calls are intentionally unreachable.
- **PRB-Math.** Rescope AGENTS.md's "no PRB-Math anywhere in the codebase" to this repo's own `src/`. The fork is the scoped exception.
- **Naming in prose.** "OVRFLO Streams" the layer, "OVRFLO Stream" a single stream, `OVRFLOStream` the identifier form. No hyphenated or all-caps variant.

## This ticket owns / does not own

**Owns:** `x-ray/x-ray.md`, `x-ray/entry-points.md`, `x-ray/invariants.md`, `x-ray/architecture.svg`, `AUDIT.md`, `PROPERTIES.md`, `docs/audit/sablier-interface-contract.md`, `docs/audit/rejected-findings-record.md`, `AGENTS.md`, `README.md`, `CONCEPTS.md`.

**Does not own:** maps ADR and projection.md trust move (08); frontend copy in `StreamDetail` degraded state (09); seed runbook comments (06, already in `OVRFLO.s.sol`).

## Do not

- Leave the CONCEPTS minter / rebrand paragraph in place
- Tell readers to grep-rename `sablierLL`
- Drop Sablier provenance (the ACL disproof needs the lineage)
- Cite `StreamPricing.sol:209` as create-side cliff math
- Claim fees are "currently zero" without the construction argument (SC13)
- Change Solidity or `web/` application code
- Edit the plan file
- Run a "Sablier" identifier sweep and treat hits as defects (R9: hits are expected)

## Implementation (binding)

1. Rewrite `CONCEPTS.md` "OVRFLO Streams (layer)": keep upstream Solidity names; `OVRFLOStream` is deployed ERC721 identity (`name`/`symbol` only); mint gate is `ovrfloInfo`; LockupDynamic stays unrenamed and undeployed; log-scan sentence in shipped-discovery must not contradict R12 (either point at the plan as unbuilt until 08, or — if 08 is already merged — state Enumerable). If 08 is not done, do not claim log-scan is already gone.
2. `docs/audit/sablier-interface-contract.md`: bound contract is the fork; address change; S1–S5 preserve-exactly including SC12 cliff notes.
3. `docs/audit/rejected-findings-record.md`: third-party withdraw disproof names the fork address and R3; qualify finding IDs by audit.
4. `AGENTS.md`: finding summaries name the fork with lineage; PRB-Math fact rescoped; onboarding contract map uses `sablierLL` as the getter name and the fork as the value.
5. `AUDIT.md` scope table: "OVRFLO does not modify Sablier" is now false for the bound deployment — we bind a fork we own. State that precisely.
6. `x-ray/*`: call chains by live interface name; architecture.svg label redrawn (not a find-replace on the SVG if that breaks the drawing).
7. `PROPERTIES.md`: four properties that cite the stream field still true against the fork.
8. `README.md`: stream layer is OVRFLO Streams; identifiers in code stay Sablier-named.
9. `x-ray/entry-points.md`: factory `setOvrfloStream` (once) and `setStreamNFTDescriptor`; no `transferAdmin` forwarder; unreachable `onlyAdmin` fork calls listed.
10. Record the R8 registration trust shift (bytecode identity ≠ correct stream binding).

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

### Session intent (posted before first write)

- **Assumptions:** U5 rebound Solidity; U7 is docs-only. Ticket 08 not merged (log-scan still live). Leftover U5 `AGENTS.md` / `onboarding.md` edits are a start.
- **Predicted blast radius:** `CONCEPTS.md`, `AGENTS.md`, `README.md`, `AUDIT.md`, `PROPERTIES.md`, `docs/audit/sablier-interface-contract.md`, `docs/audit/rejected-findings-record.md`, `x-ray/x-ray.md`, `x-ray/entry-points.md`, `x-ray/invariants.md`, `x-ray/architecture.svg`, ticket markdown; possibly finish stream facts in `docs/agents/onboarding.md`.
- **Verification:** R11 address-change + R3 cite in `docs/audit/`; CONCEPTS free of rebrand/`setMinter`/renamed LockupDynamic; SC13 construction language; R8 registration trust shift; no `.sol` / `web/` app changes; `git diff --stat` vs prediction.
- **Owns vs later:** U7 docs/audit/x-ray/README/CONCEPTS; U8 discovery; U6 seed.

## Deviations from the plan

- Also finished `docs/agents/onboarding.md` stream-map / mid-term / contradictions rows. Ticket Owns list names `AGENTS.md` only; leftover U5 copy plus R11's "onboarding contract map" requirement made the live map stale if left alone. Plan U7 Files list did not name onboarding; recorded here rather than editing the plan.

## Final diff

- Predicted blast radius: CONCEPTS.md, AGENTS.md, README.md, AUDIT.md, PROPERTIES.md, docs/audit/sablier-interface-contract.md, docs/audit/rejected-findings-record.md, x-ray/x-ray.md, x-ray/entry-points.md, x-ray/invariants.md, x-ray/architecture.svg; optionally docs/agents/onboarding.md; ticket markdown (orchestrator path, not in worktree commit).
- Actual (`git diff --stat` for `4e66f80` vs `edc06d7`):

```
 AGENTS.md                                | 55 +++++++++++++--------
 AUDIT.md                                 |  2 +-
 CONCEPTS.md                              |  6 +--
 PROPERTIES.md                            | 10 ++--
 README.md                                | 48 +++++++++---------
 docs/agents/onboarding.md                | 84 +++++++++++++++++++-------------
 docs/audit/rejected-findings-record.md   | 17 ++++---
 docs/audit/sablier-interface-contract.md | 58 +++++++++++++++-------
 x-ray/architecture.svg                   |  4 +-
 x-ray/entry-points.md                    | 37 ++++++++++----
 x-ray/invariants.md                      |  6 +--
 x-ray/x-ray.md                           | 24 +++++----
 12 files changed, 215 insertions(+), 136 deletions(-)
```

- Misses: none against the predicted set. `docs/agents/onboarding.md` was predicted as optional and landed. Ticket file updated in main checkout only (orchestrator tracker path). `docs/audit/trust-assumption-ledger.md` / `scope-snapshot.md` still cite canonical `0xAFb979…` — outside U7 Owns list; left untouched.

**Commit:** `4e66f80d6600dec594c45f927f5c36cfa0119efc` on `feat/u7-docs-audit-rebind` (worktree `/Users/jay/OVRFLO-u7`). Not pushed.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] `docs/audit/` names the fork as the bound contract, states `sablierLL` no longer resolves to `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`, and cites R3 (R11 gate)
- [x] S1–S5 preserve-exactly set includes cliff encoding, consume-side `CliffPresent`, withdraw-hook predicate, SETTLED `isCancelable` (SC12)
- [x] `CONCEPTS.md` no longer claims identifier rebrand, `setMinter`, or renamed LockupDynamic
- [x] Prose uses "OVRFLO Streams" / "OVRFLO Stream" / `OVRFLOStream`; no hyphenated all-caps variant
- [x] `AGENTS.md` PRB-Math sentence is scoped to this repo's `src/`
- [x] `x-ray/entry-points.md` lists `setOvrfloStream` and `setStreamNFTDescriptor` and records unreachable admin calls
- [x] Fees described as immutable by construction (SC13), not as a policy the Safe could change
- [x] R8 trust shift is written: registration is the safe vault predicate after KTD6
- [x] `AUDIT.md` / `x-ray` / `PROPERTIES.md` / `README.md` agree with R1/R9/R11
- [x] No Solidity or application-code change in this ticket

## Plan unit

U7 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
