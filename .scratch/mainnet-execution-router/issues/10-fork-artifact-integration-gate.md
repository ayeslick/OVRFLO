# 10 — Fork artifact integration gate

**What to build:** The re-vendor boundary: after ticket 07 lands in the fork, regenerate the
vendored `OVRFLOStream` artifact in OVRFLO and strengthen the provenance gate so a fork-source /
vendored-artifact mismatch can never be green. Provenance chain (008, zFi-adopted): fork source
commit → canonical compiler settings (solc 0.8.23, fork profile) → artifact hash → ABI hash →
runtime bytecode hash → vendored artifact.

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign` (reads the fork repo, changes
only OVRFLO).

**Blocked by:** 07 | **Status:** resolved — merged at 56133b0 (aebf469). Review: approve. Residual (not blocking): descriptor hashes recorded but not pretest-gated; rebuild compares runtime only. No CI. | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.5-high`, subagent_type `generalPurpose`

## Session prompt

```text
Fork artifact integration gate per 008's fork re-vendor boundary.
Ticket: .scratch/mainnet-execution-router/issues/10-fork-artifact-integration-gate.md
Spec: .scratch/mainnet-execution-router/spec.md.

Before first write: echo both repos' branch + HEAD; paste the fork ticket-07 result commit; forge
test baseline in OVRFLO.

Task: rebuild the fork artifacts at the ticket-07 head under the fork's pinned settings; vendor
the lockup (and descriptor/comptroller if they changed) into OVRFLO's artifact path; record
provenance (fork commit, solc, settings, artifact sha256, ABI sha256, runtime-bytecode sha256) in
the provenance stamp file; add/strengthen the CI gate that recomputes and compares these hashes so
a stale artifact fails loudly. Then run OVRFLO's fork-consuming tests (test/fork/*, seed path)
against the new artifact and paste totals. Enumerable-consuming call sites in OVRFLO
(tokensOfOwnerIn/tokenOfOwnerByIndex/totalSupply) that now fail are EXPECTED — inventory them
with file:line and return the list as a blocker-report for tickets 11/14; do not fix frontend
here. Fix only test/seed plumbing that this gate owns.

Intent record before first write. Do not edit plans. Do not push.
```

## Owns / does not own

**Owns:** vendored artifacts, provenance stamp + gate, fork-consuming test/seed plumbing,
the Enumerable-callsite inventory.
**Does not own:** frontend fixes (11/14), fork source (07), lens (09).

## Acceptance criteria

- [ ] Provenance chain recorded and CI-gated (stale artifact demonstrably fails)
- [ ] Fork-consuming tests green against the new artifact; totals pasted
- [ ] Enumerable-callsite inventory returned with file:line
- [ ] Deviations recorded; Final diff filled

## Deviations from the plan

## Final diff

## Plan unit

008 integration gate between waves 1A and 1B/3.
