---
title: DONE DATE must stay visible while the schedule hydrates
date: 2026-08-14
category: ui-bugs
module: web/components/watch/BorrowedDetail.tsx
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Borrowed detail omitted DONE DATE until useLoanStreams hydrated"
  - "A pending or empty loanStreams map looked like the loan had no cover question"
  - "Wall and detail could hide the date instead of CHECKING… or UNCOVERED"
  - "Inventory 16 had to pin both a hydrated date and a hydrating CHECKING… case"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [done-date, cover-date, borrowed-detail, checking, uncovered]
related_components: [web/tests/inventory/watch-surface.test.tsx]
---

# DONE DATE must stay visible while the schedule hydrates

## Problem

Every loan must answer "when is this over?" Ticket 14 found `BorrowedDetail`
rendered DONE DATE only after `loanCoverAt` had a schedule from
`useLoanStreams`. A pending map omitted the fact. Omission reads as "this loan
has no date," which is a lie.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- DONE DATE appeared only when a schedule existed.
- Empty `loanStreams` dropped the row instead of CHECKING….
- An uncovered loan had no named UNCOVERED value.
- Inventory could pin a hydrated date and still miss the hydrating case.

## What Didn't Work

Waiting for stream truth before mounting the fact. Split-truth rendering keeps
schedule motion honest; it does not license hiding the question.

Inventing a cover date from obligation alone. Cover date needs the pledged
stream schedule. Missing schedule is CHECKING…, not a guessed day.

Changing the dual-role home default to borrowed so a done-date is on screen in
five seconds. That default stays supplied (lenders visit most). A borrower who
also supplies must switch lens. That is an owner exception, not this fix.

## Solution

`BorrowedDetail` always renders a DONE DATE fact
(`web/components/watch/BorrowedDetail.tsx:174-179`):

- no schedule → `CHECKING…`
- `coverAt` present → formatted cover date
- else → `UNCOVERED`

Inventory 16 pins a hydrated date on the borrowed detail
(`web/tests/inventory/watch-surface.test.tsx:187-198`) and a second case with
an empty `loanStreams` map that still shows DONE DATE and CHECKING…
(`web/tests/inventory/watch-surface.test.tsx:201-209`).

## Why This Works

The label stays. The value carries freshness. CHECKING… is not a date.
UNCOVERED is not a missing row. Cover date in CONCEPTS stays the computed
answer; this learning is the fail-closed presentation while that answer is not
ready.

## Prevention

- Never omit the DONE DATE fact on borrowed detail.
- Never substitute a placeholder calendar day for a missing schedule.
- Keep the hydrating inventory case. A hydrated-only test cannot catch
  omission.

## Related Issues

- [Borrow presentation must not announce read failures as true zero](borrow-presentation-must-not-announce-read-failures-as-true-zero.md)
  — missing evidence is CHECKING…, not a true answer.
- [Confirmed claim RECEIVED must come from Claimed logs](../logic-errors/claim-confirmed-received-must-come-from-claimed-logs.md)
  — same fail-closed split: CHECKING… versus an invented number.
