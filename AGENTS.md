The system is one column tower. Start at `docs/agents/system.md`. Then read `docs/agents/onboarding.md` for the live contract map, trust ranking, and settled do/do-not. Read both before advising on or changing protocol code.

Record intent before the first code write (`docs/agents/onboarding.md`, Before writing code). Log every deviation from the active plan and why. Do not edit the plan. Compare `git diff --stat` to that prediction before calling the work done. Do not reconstruct the record afterward. Frontend state-touching changes also write the scratch intent capsule (`docs/maps/SCHEMAS.md` §4).

This file is the always-on session router, the hydra list, and landmines that hops failed to stop. It is not the live contract map. Do not add an architecture essay here.

## Open by task

- Solidity or onchain: https://ethskills.com/SKILL.md, then `docs/solutions/patterns/solidity-implementation-discipline.md`, `docs/solutions/patterns/ovrflo-coding-standard.md`, `docs/solutions/patterns/ovrflo-style-guide.md`.
- Markets frontend: `docs/solutions/patterns/ovrflo-web-standard.md` and the region brief under `docs/maps/ui/`.
- Plan declared build-ready: ignorance-lens sweep in `docs/solutions/patterns/ignorance-lens-sweep.md`.
- E2E: `docs/agents/testing.md`.
- `BASE_SECURITY.md` and `VAULT_SECURITY.md` are generic primers. Filter them through onboarding §8. Those primers suggest liquidations and extra guards this protocol rejected.

## How to explain things here — binding for every agent

Write for a reader who knows the protocol but not your jargon. Explaining is part of the work, not overhead on top of it.

- **Name the thing before you use it.** One plain sentence on what a contract, function, or mechanism *is* and *does*, then the point you are making. Never open with a signature or an identifier chain.
- **State the problem, then show the fix.** A finding without a concrete fix is half a finding. Show the before and after — actual names, actual arguments — not a description of the change.
- **One idea per sentence.** No clause-stacking. If a sentence carries a mechanism, a consequence, and a recommendation at once, split it into three.
- **Ban the shorthand that hides meaning.** No "the shape lies", "dead indirection", "load-bearing" without saying what it bears, "surface", "seam", "posture". Say what actually happens and to whom.
- **Sort findings by whether they break something.** Lead with what stops the build or ships a bug. Everything else goes in a named second group with a plain label — never "tidiness", "polish", or "nits", which tell the reader nothing about what is wrong.
- **Never relay another agent's or reviewer's output verbatim.** Sub-agent findings, audit reports, and doc-review envelopes arrive in reviewer jargon. Translate every one before it reaches the user, and attach a recommendation. Close low-stakes reviewer questions yourself with a stated recommendation rather than forwarding them.
- **Scale the response to the work.** A three-line change gets a three-line explanation. If a review of a small change produces twenty findings, sort them and say which few matter — do not deliver all twenty at equal weight.

## Before raising a security finding — read this list, not just the link

`docs/audit/` is required reading for any security review. The three findings below have been raised, disproven, and re-raised by a later reviewer who read the linked file but did not open it. They are enumerated here so the collision is visible **without a second hop**. If your finding matches one, the record is your starting point, not a wall — bring new evidence or move on.

- **Third-party stream withdrawal diverging lending accounting.** Raised as internal-review `H-2` and again as `audit-2026-07-28 H-1`. **Disproven both times:** the bound lockup is OVRFLO Streams — a fork of Sablier v2-core v1.1.2 (Solidity `SablierV2LockupLinear`, ERC721 identity `OVRFLOStream`). Vault getter `sablierLL` **no longer** resolves to canonical `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. The fork preserves the v1.1 withdraw ACL byte-for-byte (**plan R3**): `withdraw` reverts unless the caller is the stream sender, NFT owner, or approved operator. The vault has no withdraw path and the market approves no operator. Newer Sablier Lockup docs describe a public withdraw-to-recipient path — **that is a different version than the fork lineage.** Checking only canonical Sablier is not following evidence.
- **R-01 — on-chain 18-decimal enforcement for PT.** Declined by design; Pendle PT is always 18 decimals and the multisig validates series onboarding. Re-raised as the 2026-07-28 audit's `L-1`.
- **Critical pattern #4 — address-scoped self-match prevention.** A correctness guard against an irrational self-loan state, not a security boundary; bypassing it with a second EOA gains nothing. Re-raised as the 2026-07-28 audit's `L-12`.

**Finding IDs collide across audits** — the internal review and the 2026-07-28 audit both use `H-1`, `H-2`, `L-1`, `L-2`, and `I-4` for unrelated findings. Always qualify an ID with its audit when citing one.

Full disproofs and evidence: `docs/audit/rejected-findings-record.md`. Sablier ACL table: `docs/audit/sablier-interface-contract.md`. Enforceable rules: `docs/solutions/patterns/ovrflo-critical-patterns.md`.

## Landmines

- Agent commits must use the plumbing bypass in `.cursor/rules/no-commit-attribution.mdc`. Never run bare `git commit`. Message style: `.cursor/rules/commit-message-style.mdc`.
- Do not run `forge script --broadcast` against a local Anvil fork ([foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714)). Use `bash script/seed-local.sh` (driven by `npm --prefix web run bootstrap:local`).
- Real invariant runs need `FOUNDRY_PROFILE=invariant`. The default invariant profile is 25 runs / depth 10.
- Do not edit plan files while implementing them. Plans live under `docs/plans/`.
- Project, contract, and token names use `OVRFLO` (never `OVFL`). ovrfloToken symbols get an `OVRFLO`/`overflo` prefix.
- Do not duplicate what the timelocked multisig already validates. Keep code Pendle-specific. Do not add `disableSeries`/`enableSeries` toggles.
- No PRB-Math in this repo's `src/`. The OVRFLO Streams fork keeps `@prb/math` as a scoped exception.
- `gh` is installed and authenticated on this machine. Use it for GitHub PRs, issues, and API calls.
- Campaign tickets live under `.scratch/`, not GitHub Issues. Canonical labels (no renames): `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
