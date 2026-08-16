# 01 — Fork repo bring-up

**What to build:** The sibling repo `OVRFLO-Streams` exists: full Sablier v2-core v1.1.2 source, unrenamed, inherited tests green against a recorded baseline. Seven BUSL headers converted to GPL. Dated GPL §5(a) modification notice in `CHANGES.md`.

**Repo:** sibling `OVRFLO-Streams` (GPL). Not this OVRFLO repo.

**Blocked by:** None.

**Status:** resolved (2026-08-14). Commits `e56dc1fe`..`cf75c264` on branch `fork/bring-up`.

**Labels:** ready-for-agent

Do not re-run this ticket. Remaining fork hygiene is ticket **02** (delete `test/utils/Precompiles.sol`; add the `LICENSE.md` scope note if still missing). Tickets **02–10** require the intent record in `.scratch/ovrflo-streams/spec.md` (and `docs/agents/onboarding.md` § Before writing code) before the first code write. Do not reconstruct one for this resolved ticket.

## Session prompt (paste into a new chat)

```text
Do not implement this ticket. Status is resolved.

U1 shipped in sibling repo OVRFLO-Streams on fork/bring-up
(commits e56dc1fe..cf75c264). Next frontier is ticket 02
(.scratch/ovrflo-streams/issues/02-erc721enumerable-and-mint-gate.md)
and ticket 03 in parallel.

Do not edit docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md.
```

**Required reading:** none for new work. For provenance only:

- Plan ### U1, OQ1, SC1–SC4, SC21
- `.scratch/ovrflo-streams/spec.md`

## Settled decisions this ticket must not reopen

These already shipped. Later tickets must not undo them.

- Source from tag `v1.1.2` commit `a4bf69cf7024006b9a324eef433f20b74597eaaf`. Never `main`. Never a newer Lockup tag.
- Rename nothing in source (R1). Solidity lockup name is `SablierV2LockupLinear`. Solidity comptroller name is `SablierV2Comptroller`. `OVRFLOStream` is deployed ERC721 identity only. ERC721 `name`/`symbol` stay upstream until ticket 03.
- LockupDynamic stays in the tree and is never deployed.
- Own GPL-3.0-or-later repo. This OVRFLO repo stays MIT and never compiles the fork (KTD1, OQ4).
- Inherited `test/` is UNLICENSED. Public publish uses a scrubbed tree. Do not push `fork/bring-up` as the public branch (OQ1).
- `solarray` is inlined. Do not re-add the dead GitHub pin.
- PRB-Math 4.0.2 stays in the fork.

## Leftover owned by ticket 02 (do not do it here)

- SC1: `test/utils/Precompiles.sol` still exists (only remaining BUSL-1.1 header). U2 deletes it on the first commit.
- SC4: `LICENSE.md` still needs the scope note at its head if U1 left the bare GPL text.

## Acceptance criteria (shipped)

- [x] Repo exists as a local clone of v1.1.2, not a GitHub fork of Sablier
- [x] Seven BUSL file headers converted; `git diff --stat v1.1.2 -- src/` is those seven files, SPDX only, no code
- [x] `LICENSE.md` is GPL text; `CHANGES.md` carries dated GPL §5(a) notice (SC3)
- [x] Baseline recorded in fork README: 624/625 under `forge test --no-match-path "test/fork/*"`; 619/625 under `FOUNDRY_PROFILE=test-optimized` with the same path filter
- [x] Failures characterized as pre-existing (`MemoryOOG` in a LockupDynamic test; five `Precompiles_Test` bytecode-equality tests that R7 deletes)
- [x] `upstream` is push-disabled; bare mirror at `~/ovrflo-streams-full.git`; pristine UNLICENSED tarball at `~/ovrflo-streams-inherited-tests-v1.1.2.tar.gz`
- [x] `solarray` inlined so a clean checkout installs

## Plan unit

U1 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
