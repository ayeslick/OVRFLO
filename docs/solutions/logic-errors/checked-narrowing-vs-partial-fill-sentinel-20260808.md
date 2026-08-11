---
title: Checked narrowing vs. partial-fill sentinels — a helper that reverts is wrong for a value that means "as much as possible"
date: 2026-08-08
category: logic-errors
module: src/OVRFLOLending.sol (borrow target conversion)
problem_type: logic_error
component: lending-market
severity: high
applies_when:
  - A parameter uses a max-value sentinel to mean "no limit / as much as possible"
  - A conversion helper with checked narrowing (SafeCast) sits on that parameter's path
  - A refactor proposes unifying inline conversions into the checked helper
tags: [safecast, sentinel, partial-fill, narrowing, refactor-trap]
---

# Checked narrowing vs. partial-fill sentinels — a helper that reverts is wrong for a value that means "as much as possible"

## Context

`borrow` documents `targetBorrow == type(uint128).max` as the max-borrow
sentinel: fill as much as the tick allows. The conversion discipline elsewhere
routes every unit conversion through `_toUnits`, whose `SafeCast.toUint64`
checked narrowing is exactly right for real quantities — and exactly wrong
here: `_toUnits(type(uint128).max)` reverts, turning the documented "give me
everything" into a guaranteed abort. The fix (dated plan note, 2026-08-08) is
an inline floor — `uint256(targetBorrow) / UNIT` before the `min` — recorded
as the ONE deliberate exception to the conversion discipline.

## The trap this writeup exists to prevent

The bug is not the original code — it is the future "cleanup." An
intent-blind refactor that unifies the inline division back into `_toUnits`
reintroduces the revert silently: every test with realistic targets still
passes, and only a max-sentinel call dies. Three defenses ship:

1. the inline comment at the conversion site naming the exception and why;
2. the plan's dated types/units note recording it as deliberate;
3. fizz property SP-06 (`targetBorrow == type(uint128).max` partial-fills
   instead of arithmetic-faulting), which exists specifically to catch the
   cleanup-regression, not the original implementation.

## The general rule

A checked-narrowing helper encodes the assumption "this value is a real
quantity in range." A sentinel value deliberately violates that assumption.
Wherever both patterns meet, the sentinel must be resolved (clamped, floored,
or branched) BEFORE the checked conversion — and the site must say so, or the
next reader will "fix" it.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 3 (detected): SP-06 is the standing tripwire. Tier 1 was considered and
rejected — removing the sentinel (e.g. a separate `borrowMax()` entrypoint)
would make the class unrepresentable but adds an API surface for one caller
convenience; the minimality ladder favored the documented exception plus the
property. The tier-3 placement is deliberate and this note is its required
justification.

## See also

- `PROPERTIES.md` SP-06; `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` types/units note (2026-08-08).
