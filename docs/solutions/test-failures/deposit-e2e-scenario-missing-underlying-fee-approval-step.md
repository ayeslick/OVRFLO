---
title: "deposit-wrap-unwrap.feature's happy-path deposit scenario skipped the required underlying-fee approval step, leaving DEPOSIT permanently gated"
date: 2026-07-28
category: test-failures
module: web/tests/e2e/deposit-wrap-unwrap.feature
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "The \"Happy path — deposit PT for ovrfloToken and a stream\" scenario clicked \"APPROVE PT\" then went straight to \"DEPOSIT\", but the DEPOSIT button in ActionModal.tsx only renders once both `needsPtApproval` and `needsUnderlyingApproval` are false — the scenario never satisfied the second condition, so the deposit button either did not exist yet or the click landed on the wrong (still-approval) button."
  - "OVRFLO's `deposit()` (src/OVRFLO.sol:369-422) performs two separate `safeTransferFrom` calls against two different tokens — the PT token for `ptAmount` (line 389) and the underlying wstETH token for `feeAmount` sent to `TREASURY_ADDR` (line 398) — so a single PT approval can never cover the transaction; the UI's two-approval gating is a direct, necessary reflection of that on-chain reality, not an artifact that could be relaxed."
  - "No Playwright artifact for this scenario survives in web/test-results/ (only a passing `.last-run.json` with an empty `failedTests` array remains) — there is no captured failure trace to cite; the gap was identified by reading the gating logic rather than by a recorded test run failure."
root_cause: missing_workflow_step
resolution_type: test_fix
related_components: [web/components/ActionModal.tsx, web/lib/convert.ts, src/OVRFLO.sol, web/tests/e2e/deposit-wrap-unwrap.feature]
tags: [e2e, playwright, gherkin, deposit, approval-flow, two-step-approval, wsteth, fee, ovrflo]
---

# deposit-wrap-unwrap.feature's happy-path deposit scenario skipped the required underlying-fee approval step, leaving DEPOSIT permanently gated

## Problem

The Gherkin scenario "Happy path — deposit PT for ovrfloToken and a stream" in `web/tests/e2e/deposit-wrap-unwrap.feature` modeled the OVRFLO deposit flow as a single approval followed by the deposit itself: click `APPROVE PT`, then click `DEPOSIT`. That matches the mental model "I approve the token I'm depositing, then I deposit it" — but OVRFLO's deposit path actually requires two independent ERC-20 approvals from two different tokens before the deposit action is available at all: one for the PT amount being deposited, and a separate one for a fee charged in the underlying token (wstETH). The scenario only performed the first approval, so the deposit button's gating condition was never fully satisfied.

## Symptoms

- The scenario clicked `"APPROVE PT"` then immediately `"DEPOSIT"`, skipping any step for the underlying-token approval.
- In `web/components/ActionModal.tsx`, the button rendered in deposit mode is chosen by a three-way conditional (lines 670-705): `needsPtApproval ? <APPROVE PT> : needsUnderlyingApproval ? <APPROVE {underlyingSymbol}> : <DEPOSIT>`. With `needsUnderlyingApproval` still `true` after only approving PT, the actual `DEPOSIT` button never renders — the scenario's `"DEPOSIT"` click would either fail to find that button or hit the still-present `APPROVE wstETH` button instead, never actually submitting the deposit transaction.
- `needsUnderlyingApproval` is computed by `convertApprovalNeeds` in `web/lib/convert.ts:30-55`: for `mode === "deposit"`, it is true whenever `feeAmount > 0n` and the underlying allowance/approved-amount are below `feeAmount` (`web/lib/convert.ts:48-53`). Since OVRFLO's deposit fee is non-zero for the test market, this condition holds until the wstETH approval is explicitly performed.
- No surviving Playwright trace exists for this specific scenario under `web/test-results/` — the directory currently holds only `.last-run.json` reporting `{"status": "passed", "failedTests": []}`, i.e. a subsequent, already-fixed run. There is no captured error log or trace archive to quote for the originally-broken run.

## What Didn't Work

There is no evidence of a multi-step debugging trail for this specific fix — no failed-run artifact, no series of ruled-out hypotheses. The commit that introduced this fix (`c1024d9`, "fix: harden local E2E bootstrap and treat on-chain reverts as failures") bundled several fixture and step corrections discovered together during "the first full suite run" (per its commit message), and this one has the shape of a fix found by reading the gating logic once a stuck `DEPOSIT` button surfaced, rather than a prolonged investigation. Two other scenarios in the same file and same commit (the deposit-cap-reached and unwrap-reserve scenarios) were fixed in the same diff by inserting a missing `"the frontend re-syncs with chain state"` step — a different root cause (stale reads after fixture-direct chain mutation, documented separately in `docs/solutions/workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md`) — but this deposit-approval gap is not that: it is a missing UI-interaction step (a second required approval click), not a stale-read race. It's called out here plainly rather than manufacturing a false struggle: read `web/components/ActionModal.tsx`'s approval-gating conditional once, cross-referenced against `src/OVRFLO.sol`'s two-`transferFrom` deposit body, and the missing step was obvious.

## Solution

Added the missing approval step between the PT approval and the deposit click, in `web/tests/e2e/deposit-wrap-unwrap.feature` (lines 11-19):

```gherkin
Scenario: Happy path — deposit PT for ovrfloToken and a stream
  When I expand the active market
  And I click the "DEPOSIT PT" button
  Then the "DEPOSIT PT" modal is open
  And I fill the amount field with "10"
  And I click the "APPROVE PT" button
  And I click the "APPROVE wstETH" button
  And I click the "DEPOSIT" button
  Then I see the caption "CONFIRMED"
```

Previously (per `git show c1024d9 -- web/tests/e2e/deposit-wrap-unwrap.feature`), the scenario went directly from `"APPROVE PT"` to `"DEPOSIT"` with no intervening `"APPROVE wstETH"` step.

## Why This Works

The two-approval requirement is not a UI quirk — it mirrors two separate on-chain transfers inside `OVRFLO.deposit()` (`src/OVRFLO.sol:369-422`):

```solidity
IERC20(info.ptToken).safeTransferFrom(msg.sender, address(this), ptAmount);          // line 389

(toUser, toStream) = _computeSplit(ptAmount, rateE18);
...
uint256 feeAmount = StreamPricing.fee(toUser, info.feeBps);

if (feeAmount > 0) {
    IERC20(underlying).safeTransferFrom(msg.sender, TREASURY_ADDR, feeAmount);        // line 398
    emit FeeTaken(msg.sender, underlying, feeAmount);
}
```

The first `safeTransferFrom` pulls `ptAmount` of the PT token into the vault. The second, independent `safeTransferFrom` pulls `feeAmount` of the underlying token (wstETH) to `TREASURY_ADDR` — a market-value fee taken separately from the deposit itself. Because these are two different ERC-20 contracts, the caller (the connected wallet) must grant two separate allowances: one on the PT token for `ptAmount`, one on the underlying token for `feeAmount`. A single "approve PT" click can never authorize the underlying-token transfer.

The frontend surfaces this correctly. `ActionModal.tsx`'s deposit-mode summary row (lines 632-645) shows the fee explicitly and denominates it in the underlying symbol, not PT:

```tsx
{depositPreview ? (
  <>
    TO WALLET {formatTokenAmount(depositPreview[0], ovrfloSymbol)} / STREAM{" "}
    {formatTokenAmount(depositPreview[1], ovrfloSymbol)} / FEE {formatTokenAmount(feeAmount, underlyingSymbol)}
  </>
) : ...}
```

And `convertApprovalNeeds` (`web/lib/convert.ts:30-55`) computes both approval flags from the two independent allowances:

```ts
const needsPtApproval = mode === "deposit" && amount > 0n && ptAllowance < amount && ptApprovedAmount < amount;
const underlyingRequired = mode === "wrap" ? amount : feeAmount;
const needsUnderlyingApproval =
  ((mode === "deposit" && feeAmount > 0n) || mode === "wrap") &&
  amount > 0n &&
  underlyingAllowance < underlyingRequired &&
  underlyingApprovedAmount < underlyingRequired;
```

`ActionModal.tsx` then renders exactly one gating button at a time (lines 670-705): `APPROVE PT` while `needsPtApproval` is true, then `APPROVE {underlyingSymbol}` (i.e. `APPROVE wstETH`) while `needsUnderlyingApproval` is true, and only the real `DEPOSIT` button once both are false. Adding the `"APPROVE wstETH"` click between the PT approval and the deposit click satisfies `needsUnderlyingApproval`, so the conditional falls through to the actual `DEPOSIT` button and the scenario can proceed to a genuine on-chain confirmation.

## Prevention

- When a scenario walks through a multi-token flow (any deposit, swap, or wrap that touches more than one ERC-20), enumerate every `transferFrom` in the corresponding Solidity function first and make sure the Gherkin scenario has one `APPROVE <TOKEN>` step per token pulled from the caller — not one step per "logical action" the tester has in mind.
- `ActionModal.tsx`'s button conditional (`needsPtApproval ? ... : needsUnderlyingApproval ? ... : <action button>`) is a reliable single source of truth for "how many approvals does this mode need, in what order" — read it (or its backing `convertApprovalNeeds` in `web/lib/convert.ts`) before writing or reviewing any new deposit/wrap Gherkin scenario, rather than inferring the click sequence from the contract alone or from UI intuition.
- Because no failure artifact for this scenario survived in `web/test-results/`, prefer preserving Playwright trace/output for at least one failing run per fixed scenario when a suite-wide hardening pass touches many `.feature` files at once (as commit `c1024d9` did) — it makes "what actually broke and how" reconstructable later instead of relying on the fix's own correctness as the only evidence the bug existed.

## Related Issues

- `docs/solutions/test-failures/expand-active-market-step-toggle-not-idempotent-collapses-position-list.md` — same e2e suite and same commit batch, also a Gherkin/test-artifact defect (not an app bug) with the same higher-level lesson: a scenario's implicit assumptions about a shared UI flow (idempotent toggle there; single-approval-suffices here) can silently diverge from the app's actual behavior, only caught by exercising the real flow end-to-end. Different mechanism: that doc's bug is a non-idempotent shared step definition, not a missing step.
- `docs/solutions/workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md` — documents a different fix bundled in the same commit (`c1024d9`) to two other scenarios in this same feature file (deposit-cap-reached, unwrap-reserve-empty): a stale-read race requiring an explicit `"the frontend re-syncs with chain state"` step, not a missing approval. Useful to distinguish "missing re-sync step after fixture-direct chain mutation" from "missing approval step in a multi-token flow" — both are shaped like `missing_workflow_step` but have unrelated causes.
