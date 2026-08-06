# 01 — Audit disposition record

**Category:** docs

**Covers:** R1, R2, R3, R4 (Tranche 1 — Record). Findings: H-1 (rejected), L-1 (rejected), L-12 (rejected).

**What to build:** Every one of the 41 findings in `docs/dogfood-reports/audit-2026-07-28.md` gets a recorded disposition — fixed, rejected with rationale, or no-action informational — so no finding is left unaccounted for and a future auditor re-deriving H-1, R-01, or critical pattern #4 hits the settled record before re-raising them.

**Details:**
- Add an entry to `docs/audit/rejected-findings-record.md` for each of H-1, L-1, and L-12, naming the disproof and the evidence:
  - H-1: the deployed Sablier at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` is v2-core `v1.1`, whose `withdraw` reverts `SablierV2Lockup_Unauthorized` unless the caller is the stream sender, the NFT owner, or an approved operator — the vault-as-sender has no withdraw code path and the market never approves an operator, so the divergence H-1 describes cannot be produced. Evidence already pinned in `docs/audit/sablier-interface-contract.md`.
  - L-1: re-raises R-01 (on-chain 18-decimal enforcement), already rejected by design — point to the existing R-01 record.
  - L-12: re-raises critical pattern #4 (address-scoped self-match prevention, trivially bypassed with a second EOA), accepted by design — point to `docs/solutions/patterns/ovrflo-critical-patterns.md`.
- H-1 produces no code change of any kind — no defensive clamp on the claim arithmetic. Adding one would imply the threat model is live; it isn't under the pinned v1.1 ACL.
- Update the security-review entry point (wherever `docs/audit/` is named as required reading — check `AGENTS.md` and any linked audit index) to enumerate the settled findings inline by ID — H-1, R-01, and critical pattern #4 — so a reviewer sees the collision without opening a linked file. This is the fix for the observed failure mode: `AGENTS.md` already named `docs/solutions/patterns/ovrflo-critical-patterns.md` as required reading, and the 2026-07-28 audit still re-derived R-01 and pattern #4 despite reading closely — a pointer alone didn't prevent the re-raise, so the settled IDs need to be visible at the entry point itself, not one hop away.
- Every other finding in the appendix disposition table (`docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md`, "Appendix: Finding disposition index") gets its disposition recorded somewhere durable — either this record (for rejections/no-action) or implicitly via the tickets that fix it (H-2 through L-13). I-1, I-2, I-6 are no-action/informational and should get a one-line rationale each (I-1: a contract-wide `nonReentrant` on `OVRFLO.wrap` would break the documented flash-loan callback carve-out recorded in `src/OVRFLO.sol`; I-2 and I-6: exemption/exposure already bounded, no change).

**Acceptance criteria:**
- [x] `docs/audit/rejected-findings-record.md` has a dated entry for H-1, L-1, and L-12, each naming the specific disproof and its evidence source
- [x] The security-review entry point lists H-1, R-01, and critical pattern #4 inline, by ID, without requiring a second hop to another file
- [x] I-1, I-2, I-6 each have a recorded one-line no-action rationale
- [x] No code in `src/` or `web/` changes as part of this ticket (a test-only addition under `test/fork/` was made — see the comment below)

**Out of scope:**
- A standing audit-scope preamble document (deferred per the plan)
- Any code change for H-1, I-1, I-2, or I-6

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 1). Source finding: `docs/dogfood-reports/audit-2026-07-28.md`.

## Comments

**2026-07-28 (to-tickets):** Generated from the audit remediation plan via `/to-tickets`. Docs-only, no code — safe to run first and in parallel with everything else.

**2026-07-29 (implemented):** Landed as U1 on branch `fix/audit-2026-07-28-tranche-1`.

Two things doc review surfaced that changed this ticket's shape:

*Finding IDs collide across audits.* `docs/audit/rejected-findings-record.md` already used `H-2` for the Sablier withdraw-ACL rejection that *this* audit calls `H-1`, and its `H-1 → L-1` entry explicitly says "L-1 remains an active Low finding … Do not treat L-1 as rejected." Writing bare IDs would have planted a direct contradiction in the same file and pointed the next reviewer at the wrong rows — the exact second-hop failure this ticket exists to close. Every new entry is qualified `audit-2026-07-28 <ID>`, a collision warning sits at the top of the record, and cross-reference lines were added to the two colliding legacy entries.

*The H-1 disproof was not reproducible from the repo.* `test_LendingEscrow_StrangerCannotWithdrawFromEscrowedStream` looked like the guard, but all three of its cases pass `to` = caller, which reverts under v1.1 **and** under the later ACL that made `to == recipient` permissionless — so it could not discriminate the version the whole rejection rests on. Added a fourth case: a stranger pushing `withdraw(streamId, address(lending), withdrawable)`. That is precisely what H-1 claims a third party can do; it reverts against the deployed bytecode. The rejection entry now cites a test that can actually fail. This required narrowing R3's "no code change of any kind" to production code under `src/` — recorded in the plan.

`AGENTS.md` now enumerates the three settled findings inline with their disproofs, so a reviewer meets them without opening a linked file.

Verification: `forge build` clean; `forge test` 372 passed / 0 failed; the new fork case passes against mainnet state via `MAINNET_RPC_URL`.
