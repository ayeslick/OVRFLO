---
title: "Sweeping living docs after a public function removal — the poolClaimLoan case"
date: 2026-07-07
category: documentation-gaps
module: docs/
problem_type: documentation_gap
component: documentation
severity: low
applies_when:
  - "A protocol function is removed or renamed and living documentation still references it across the docs tree"
  - "Updating counts, entry-point tables, role-gated tables, or invariant derivations after a refactor changes the protocol surface"
  - "Fixing stale file-path references after docs are reorganized into subdirectories (e.g. root-level files moved under docs/audit/ or docs/solutions/best-practices/)"
  - "Coordinating a bulk documentation update across ~20 files efficiently using parallel subagents"
  - "Removing incorrect gitignore claims or historical-status assumptions from living docs that must always reflect current protocol state"
root_cause: inadequate_documentation
resolution_type: documentation_update
tags: [documentation, living-docs, refactor, poolclaimloan, ovrflobook, bulk-update, docs-debt]
---

# Sweeping living docs after a public function removal — the poolClaimLoan case

## Context

The `poolClaimLoan` function was removed from `src/OVRFLOBook.sol` as part of the `refactor/remove-poolclaimloan` branch. After the removal, `claimPoolShare` became the sole pool claim function, handling both open and closed loans through the internal `_claimFair` helper, which harvests deficit from open loan streams before paying out from the shared `poolProceeds` pool. That single source-code deletion, however, left a long tail of documentation references across the repository.

This is a repo where the user treats nothing as historical — "everything is living." So every doc that described `poolClaimLoan` as a current entry point, used it in an example, or counted it in an overview table was now stale and had to be found and updated. The blast radius turned out to span roughly twenty files across `AUDIT.md`, the `x-ray/` directory, `docs/audit/*`, `docs/solutions/*`, `CLAUDE.md`, `AGENTS.md`, and several ideation documents.

Compounding the source-code change, three independent doc-accuracy problems surfaced during the same pass and had to be fixed together:

1. **AGENTS.md carried incorrect instructions** to "gitignore" `docs/plans/`. The plans were never actually gitignored, and the instruction actively misled agents into treating tracked plan files as untracked — a hazard that can cause missing commits and lost work.
2. **Two doc files had been relocated** without updating cross-references: `AUDIT_FINDINGS.md` moved to `docs/audit/audit-findings.md` and `SOLIDITY_TEST_REVIEW.md` moved to `docs/solutions/best-practices/solidity-test-coverage-review.md`. Seven references across `AUDIT.md`, `x-ray/x-ray.md`, and `docs/plans/` still pointed at the old root-level paths.
3. **Overview counts had drifted.** The critical-pattern count rose from 12 to 17 enforceable rules, the entry point count fell from 42 to 41 (the role-gated bucket went from 5 to 4 after `poolClaimLoan` removal), and the test count changed to 195. These aggregate numbers live in `AUDIT.md` and `x-ray/x-ray.md` and are the first thing an auditor reads.

The gap, then, was not a single stale paragraph but a distributed set of references whose only common thread was the removed function name and the broader "everything is living" contract. Closing it required a systematic sweep rather than a targeted edit.

## Guidance

The core practice is to treat any public/external function removal or rename as a documentation event with a repo-wide blast radius, and to run that sweep in a structured way rather than editing opportunistically.

**Find every reference first, before touching anything.** Search the entire documentation surface, not just the files adjacent to the changed source. A targeted ripgrep over markdown is the starting point:

```bash
rg "poolClaimLoan" --type md
```

That single command surfaced references in audit reports, x-ray entry-point listings, solution writeups, plan files, instruction files, and ideation notes — most of which are not co-located with the source contract. Run it (and variants for related names like `poolClaim` or internal helpers) before making any edits, so you can scope the full work up front rather than discovering missed references after you think you are done.

**Categorize each reference before editing.** Not every hit deserves the same treatment. Sort references into four buckets:

- **(a) Living docs describing current state** — must be updated. This includes `AUDIT.md` entry-point tables, `x-ray/invariants.md`, `CLAUDE.md` architecture descriptions, and `AGENTS.md` workspace facts. These describe the protocol as it is today, so a removed function is a lie that must be corrected.
- **(b) Solution writeups using the function in examples** — update the example, or add a removal note if the writeup is preserved for the lesson it teaches rather than for current-state accuracy. The writeup's value is the pattern, not the specific function name.
- **(c) Historical commit logs and changelog entries** — leave as-is. These record what happened at a point in time; rewriting them would falsify history.
- **(d) Plan files describing completed work involving the function** — leave as-is or add a short status note. Plans are read-only specs of past work; editing their bodies violates the "do not edit plan files while implementing" convention, but a trailing status annotation is acceptable when the plan references something that no longer exists.

This categorization prevents two failure modes: leaving living docs stale (the original problem) and corrupting historical records by "fixing" them to match the present.

**Parallelize across the doc tree.** For a sweep this large, use parallel worker subagents grouped by directory rather than serially editing each file. A sensible grouping for this repo was: (1) `AUDIT.md` plus the `x-ray/` directory, (2) `docs/audit/*`, and (3) `docs/solutions/*`. Each group is a coherent unit of related references, and parallelism collapses a twenty-file pass into roughly three concurrent batches. Give each subagent the categorization rules above so the buckets stay consistent across groups.

**Fix file-path references in bulk where possible.** When the change is a pure path relocation, a `sed` in-place replacement across many plan files is faster and less error-prone than hand-editing each one:

```bash
sed -i '' 's|AUDIT_FINDINGS\.md|docs/audit/audit-findings.md|g' docs/plans/*.md
sed -i '' 's|SOLIDITY_TEST_REVIEW\.md|docs/solutions/best-practices/solidity-test-coverage-review.md|g' docs/plans/*.md
```

Reserve bulk `sed` for unambiguous path strings; reserve manual edits for prose where the surrounding sentence also needs rewording.

**Update aggregate counts last, after the prose sweep.** Counts in overview docs (`AUDIT.md`, `x-ray/x-ray.md`) should reflect the post-sweep reality. Re-derive them from the updated entry-point tables and pattern lists rather than trusting the old numbers plus an offset, so a miscount in one place does not propagate. In this case: the entry-point table went from "42 (11+5+26)" to "41 (11+4+26)" — the role-gated bucket dropped by one — and the pattern count went from "12 enforceable" to "17 enforceable" because new patterns had been added in the same window. The test count moved to 195. Each of these was verified against its source list, not eyeballed.

**Fix instruction files with the same rigor as code docs.** `AGENTS.md` and `CLAUDE.md` are read by every agent session, so stale conventions there are especially damaging. The incorrect "gitignore `docs/plans/`" instruction was removed outright because it was never true — the plans are tracked — and the "everything is living" principle was reinforced instead. Treat instruction-file accuracy as part of the same sweep, not a separate cleanup.

## Why This Matters

Stale documentation that references removed functions actively misleads its readers — and in this repo the readers include auditors, developers, and AI agents. An auditor opening `AUDIT.md` would have seen `poolClaimLoan` listed as a role-gated entry point and spent real time probing a function that no longer exists in the bytecode. That is wasted audit budget and, worse, a false confidence signal: the auditor might report "no issues with `poolClaimLoan` access control" on a function that cannot be called, masking the fact that the real claim path (`claimPoolShare` with `_claimFair`) was never examined under the new structure.

Incorrect "gitignore" instructions are a quieter but equally real hazard. Agents that read "gitignore `docs/plans/`" will treat tracked plan files as untracked work. In practice that means they skip staging those files, produce commits that silently omit plan updates, or even decline to touch them at all — leading to missing commits and lost work that surfaces only when someone later notices the plan and the implementation have diverged. Convention bugs in instruction files compound across every session that trusts them.

The documentation debt from a single function removal is large: over twenty files in this case. Doing that sweep ad hoc — editing the two or three files nearest the source change and moving on — guarantees missed references. The references live in audit tables, x-ray listings, solution examples, plans, and instruction files, none of which are obviously connected to the source file. A systematic find-categorize-edit-verify approach is the only reliable way to close the gap, and it is cheap relative to the cost of a misled audit or a lost commit downstream.

## When to Apply

- After removing or renaming any public or external function from a Solidity contract (or any contract whose interface is documented as a current-state entry point).
- After relocating documentation files within the repo, since cross-references will still point at the old paths.
- After changing entry point counts, pattern counts, or test counts that are summarized in overview or audit documents.
- When instruction files (`AGENTS.md`, `CLAUDE.md`, or equivalent) contain stale guidance about repo conventions such as ignore rules, file locations, or workflow steps.
- Any time the repo operates under an "everything is living" documentation contract, where historical and current-state docs are not separated by location and must be distinguished by categorization instead.

## Examples

**Function removal — the `poolClaimLoan` sweep.** Removing `poolClaimLoan` from `src/OVRFLOBook.sol` required updating over twenty files. The role-gated entry-point bucket in `AUDIT.md` dropped from five to four; `claimPoolShare` was documented as the sole pool claim path with `_claimFair` harvesting deficit from open loans before paying from `poolProceeds`. Solution writeups that used `poolClaimLoan` in examples got either updated examples or a removal note. `CLAUDE.md` and `AGENTS.md` architecture descriptions were rewritten to reflect the single claim function.

**File relocation — fixing seven stale path references.** `AUDIT_FINDINGS.md` had moved to `docs/audit/audit-findings.md` and `SOLIDITY_TEST_REVIEW.md` to `docs/solutions/best-practices/solidity-test-coverage-review.md`, but references in `AUDIT.md`, `x-ray/x-ray.md`, and several `docs/plans/` files still pointed at the root-level paths. A bulk `sed -i ''` replacement across the plan files plus targeted manual edits in the two overview docs closed all seven references.

**Count updates — re-deriving from source lists.** In `AUDIT.md` the entry-point table changed from "42 (11+5+26)" to "41 (11+4+26)" once the role-gated list was recounted without `poolClaimLoan`. The pattern count moved from "12 enforceable" to "17 enforceable" to reflect patterns added in the same window. The test count was updated to 195. Each number was verified against its underlying list rather than computed by subtracting one from the old total.

**Instruction-file correction — removing a convention that was never true.** `AGENTS.md` instructed agents to "gitignore" `docs/plans/`, but the plans were tracked the whole time. The instruction was deleted and the "everything is living" principle was reinforced, so future sessions stage plan edits normally instead of skipping them.

## Related

- `docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md` — established the "do not let documentation describe features that do not exist" rule that this learning applies at scale (~20 files) during the poolClaimLoan removal.
- `docs/solutions/architecture-patterns/ovrflobook-pool-only-lending-consolidation.md` — documents the precursor refactor (single-party lending removal) that set up the later poolClaimLoan removal; same consolidation lineage.
- `docs/solutions/best-practices/triage-fix-and-document-audit-findings.md` — per-finding pattern-doc sync discipline; this learning generalizes from per-finding to repo-wide living-docs sync after a refactor.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` — the enforceable-rules list whose count (12 to 17) is one of the aggregates maintained by this sweep.
- `AUDIT.md` and `x-ray/x-ray.md` — the overview docs holding entry-point tables, pattern counts, and test counts that must track current state.
- `AGENTS.md` / `CLAUDE.md` — instruction files read by every agent session; stale conventions here have outsized blast radius.
