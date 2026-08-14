# 17 — ethskills:qa pre-ship audit

**What to build:** The ethskills QA pre-ship audit of the Markets dApp in a fresh reviewer context. Findings and the pass/fail checklist attach to the PR alongside ticket 15's verdict. This is the last ticket on the board; DNS/hosting/ops remain Owner work.

**Blocked by:** 16 — DESIGN.md from shipped UI

**Status:** resolved

## Session prompt (paste into a new chat)

```text
Open a fresh reviewer context. Do not continue the ticket 16 chat.

Ticket: .scratch/watch-surface-markets-experience/issues/17-ethskills-qa-pre-ship-audit.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Plan: docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md — Tail ownership (ethskills:qa pre-ship audit), Frontend Hardening (build/review gates only — not ops), Verification Contract, Definition of Done.

Follow the ethskills `qa` skill against the shipped Markets frontend. Do not change Solidity. Do not start a new visual pass. Do not execute DNS/hosting/registrar/IPFS/deploy-key/incident-switch ops. Do not edit the plan.

Before any writes, read Required reading. After the audit report is written and attached, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Tail ownership, Frontend Hardening (gates vs ops), Verification Contract, Definition of Done
- ethskills `qa` skill (frontend-ux / frontend-playbook as it directs)
- Ticket 15 verdict and ticket 16 DESIGN.md
- `docs/agents/testing.md` if re-running E2E as part of the audit
- this ticket's acceptance criteria

- [x] Audit runs in a fresh chat after ticket 16 is resolved — **exception:** Owner sequenced U16 then U17 in this session. DESIGN.md was already rewritten.
- [x] ethskills QA checklist is completed against the shipped Markets app (wallet, network, approvals, receipts, stale/signing, see-equals-sign, CSP/supply-chain gates already in the Verification Contract)
- [x] Frontend Hardening *gates* are re-checked (no third-party scripts, pinned lockfile, CSP headers, exact-amount approvals); ops items are listed as Owner follow-ups, not silently marked done
- [x] Findings distinguish defects (must fix before ship) from Owner-escalation / ops
- [x] Defects found here are either fixed in this ticket with tests or explicitly blocked from ship with Owner-visible reason
- [x] Written report is attached for the PR (path noted in Comments), together with ticket 15's verdict — ticket 15 has no verdict; ticket 14 gate list stands in
- [x] No Solidity changes; no indexer; no health-factor UX

## Comments

Report: `.scratch/watch-surface-markets-experience/issues/17-ethskills-qa-report.md`

DESIGN.md (ticket 16): repo-root `DESIGN.md` + `.impeccable/design.json`

Fix in this ticket: borrow APPROVE STREAM now honors `signingBlockedReason`; `onApprove` / `onBorrow` return on wrong chain / stale. Test `6b` in `web/tests/inventory/borrow.test.tsx`.

Owner-blocked: mobile WalletConnect deep-link; DNS/IPFS/keys/incident switch; production env + explorer verification; production `next build` and seeded-fork E2E not re-run here.

## Plan unit

Tail (after DESIGN.md) in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
