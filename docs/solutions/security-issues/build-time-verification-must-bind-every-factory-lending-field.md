---
title: Build-time verification must bind every factory and lending field
date: 2026-07-31
category: security-issues
module: web/lib/deployment.ts, web/lib/config.ts
problem_type: security_issue
component: tooling
symptoms:
  - "A partial deployment artifact could satisfy a shallow presence check"
  - "Factory or lending fields were not all bound before a production build proceeded"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [deployment-artifact, factory, lending, build-guard, fail-closed, web]
related_components: [OVRFLOFactory, OVRFLOLending]
---

# Build-time verification must bind every factory and lending field

## Problem

U1 review found production could proceed without verifying every configured
factory/lending field against the deployment artifact. A nonzero address alone
is not enough — the wrong factory or lending still looks "configured."

## Symptoms

- Build guards checked that some anchors existed without binding the full
  factory/lending surface used at runtime
- Mis-pointed lending or factory values could reach packaging

## What Didn't Work

Checking only "address is set and not zero." That rejects empty config but not
a coherent wrong deployment.

## Solution

Build-time chain verification loads the verified deployment artifact and binds
every factory/lending field the web runtime will use. Zero addresses are
rejected for production (`web/lib/deployment.ts` / `web/lib/config.ts`
production parsers).

## Why This Works

The artifact is the operator-approved trust root. Runtime config must be a
projection of that artifact, not a parallel set of env vars that can drift.

## Prevention

- Fail the build when any required artifact field is missing or zero in
  production
- Keep packaging tests that assert missing-artifact and mismatched-field paths
  fail before bundling

## Related Issues

- [Deployable builds must reject the local runtime profile](./deployable-builds-must-reject-local-runtime-profile.md)
- Captured from Codex U1 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
