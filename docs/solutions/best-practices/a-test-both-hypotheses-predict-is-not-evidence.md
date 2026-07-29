---
title: A test both hypotheses predict is not evidence
date: 2026-07-29
category: best-practices
module: test/fork, docs/audit
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - Citing a test as proof that a security finding is invalid
  - Writing a regression test that pins third-party protocol behavior
  - Reviewing evidence in a rejected-findings record
tags: [testing, security-audit, fork-tests, sablier, falsifiability, discriminating-evidence]
---

# A test both hypotheses predict is not evidence

## Context

The audit finding `audit-2026-07-28 H-1` (previously raised as `H-2` by the
internal review) claims a third party can withdraw from a pledged Sablier
stream and divert value away from the lending market's accounting. The standing
rejection rests on a version fact: the deployed Sablier at
`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` is v2-core **v1.1**, whose
`withdraw` reverts unless the caller is the stream sender, the NFT owner, or an
approved operator.

`test/fork/OVRFLOLendingMainnetFork.t.sol` had three cases asserting exactly
that — a stranger, the former borrower, and the lender all fail to withdraw.
All three pass. **None of them tested the claim.**

Every one of them passed `to` = the caller's own address. That reverts under
v1.1 *and* under the later Sablier ACL that made `to == recipient` withdrawals
permissionless. Both versions produce identical results on all three cases, so
the tests were consistent with the finding being true the entire time.

## Guidance

**Before citing a test as evidence against a hypothesis, ask what the test
would do if the hypothesis were true. If the answer is "the same thing," it is
not evidence.**

The discriminating case is the one where the two hypotheses disagree. Here that
is a stranger pushing a withdrawal **to the recipient** — precisely what H-1
describes, permitted by the newer ACL, refused by the deployed v1.1 bytecode
(`test/fork/OVRFLOLendingMainnetFork.t.sol:289`):

```solidity
// The version-discriminating case, and the only one that disproves
// audit-2026-07-28 H-1. The three cases above all pass `to` = caller,
// which reverts under v1.1 AND under the later ACL that made
// `to == recipient` permissionless — so they cannot tell the two apart.
vm.prank(stranger);
(ok,) = address(sablier).call(
    abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, address(lending), withdrawable))
);
assertFalse(ok, "stranger must not push a withdrawal to the recipient (v1.1 ACL, disproves H-1)");
```

State the discriminating property in the assertion message. `"stranger should
not be able to withdraw"` describes a behavior; `"disproves H-1"` describes what
the test is *for*, which is what stops it being deleted or weakened later by
someone who reads it as redundant with the three cases above it.

## Why This Matters

This is distinct from — and harsher than — the usual falsifiability rule. All
three original cases were falsifiable: a broken ACL would have failed them. They
were sound tests. They simply had **no discriminating power** over the two
hypotheses actually in contention, and a sound test with no discriminating power
is indistinguishable, from the outside, from a decisive one. Both are green.
Both look like coverage.

The consequence is concrete: H-1 has been raised, rejected, and re-raised across
two separate audits. Each rejection cited a test suite that could not have
detected the problem it was rejecting. A rejected-findings record is only as
good as the discriminating power of its evidence — otherwise it launders a
plausible assumption into settled fact, and every later reviewer inherits it.

The version framing is what makes this easy to get wrong. Newer Sablier Lockup
documentation genuinely does describe a public withdraw-to-recipient path. That
documentation is accurate — for a **different version than the one deployed
here**. A finding grounded in current docs and a rejection grounded in v1.1 both
sound right, and only a test that separates the versions settles it.

## When to Apply

- Any test cited in `docs/audit/rejected-findings-record.md` as the basis for a rejection
- Fork tests pinning third-party protocol behavior, where the protocol has versions with different ACLs
- Reviewing a finding you believe is already disproven — check the evidence discriminates before reusing it

## Examples

**Non-discriminating** — passes under both the v1.1 ACL and the permissive one:

```solidity
vm.prank(stranger);
(bool ok,) = address(sablier).call(
    abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, stranger, withdrawable))
);
assertFalse(ok, "stranger should not be able to withdraw");
```

**Discriminating** — the only difference is the `to` argument, and it is the
entire experiment: `to` = the recipient is refused by v1.1 and allowed by the
later ACL.

```solidity
vm.prank(stranger);
(ok,) = address(sablier).call(
    abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, address(lending), withdrawable))
);
assertFalse(ok, "stranger must not push a withdrawal to the recipient (v1.1 ACL, disproves H-1)");
```

## Related

- [Record rejected findings with rationale](./record-rejected-findings-with-rationale.md) — the record this evidence backs
- [Solidity/Foundry test quality antipatterns](./solidity-foundry-test-quality-antipatterns.md) — rule 1 covers falsifiability; this doc covers the narrower case of a falsifiable test with no discriminating power
- [Triage, fix, and document audit findings](./triage-fix-and-document-audit-findings.md) — the surrounding audit workflow
