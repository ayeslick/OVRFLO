---
title: ERC-721 ownership as the guard — delete the duplicate on-chain check, keep the test
date: 2026-08-08
category: design-patterns
module: src/OVRFLOLending.sol (borrow / stream escrow)
problem_type: design_pattern
component: lending-market
severity: medium
applies_when:
  - A guard would re-check a condition an external contract's own semantics already enforce
  - Escrowed NFTs (Sablier streams) are pledged as collateral
  - A reviewer proposes adding a "defensive" duplicate of a third-party invariant
tags: [erc721, sablier, guard-deletion, minimality, remediation-tier-1]
---

# ERC-721 ownership as the guard — delete the duplicate on-chain check, keep the test

## Context

The v1-lite plan originally specified a `StreamAlreadyPledged` error: `borrow`
would check that the pledged stream was not already backing an open loan. User
decision (2026-08-08, plan error-catalog note): the guard is structurally
redundant. A stream backing an open loan is owned by `address(lending)`
(escrowed via `transferFrom`); a second pledge attempts another
`transferFrom` from a borrower who is not the owner, which Sablier's own
ERC-721 owner check reverts unconditionally. The protocol invariant is already
enforced by the asset's own contract.

## The pattern

When an external contract's semantics make a state unreachable, the guard that
re-checks it is not defense-in-depth — it is a second implementation of the
same rule that can drift from the first. Delete the guard; **keep the test**.
The test asserts the natural ERC-721 revert on a double pledge, so if a future
integration change (a different NFT standard, an approval-based escrow) ever
re-opens the path, the suite fails and the guard question gets re-decided with
evidence rather than silently.

The nuance that makes this safe rather than lazy: the deletion was accompanied
by an explicit mechanical argument (who owns the NFT at every state, which
check in the external contract fires) recorded in the plan — not a vibe that
"Sablier probably handles it." The GL-08 fizz property (open loan's stream
always owned by the lending contract; no two open loans share a stream) keeps
the ownership premise itself under continuous check.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 1 (unrepresentable) **by removal** — the house example, cited in ticket
09's hierarchy directive. The error class ("double-pledged stream") is excluded
by the escrow design plus the asset contract's own ACL; our code carries no
second copy to rot. The surviving test and GL-08 are the tier-3 evidence that
the tier-1 premise continues to hold.

## See also

- `docs/audit/sablier-interface-contract.md` — the v1.1 ACL table this rests on.
- `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` error-catalog note (2026-08-08).
