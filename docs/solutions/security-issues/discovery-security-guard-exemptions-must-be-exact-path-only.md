---
title: Discovery security-guard exemptions must be exact-path only
date: 2026-07-31
category: security-issues
module: web/tests/scripts/banned-patterns.test.ts, web/lib/discovery
problem_type: security_issue
component: tooling
symptoms:
  - "Similarly named nested directories could inherit discovery owner exemptions"
  - "False-ready hydration and unchecked receipt decoding survived under a broad exemption"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [discovery, banned-patterns, fail-closed, hydration, lint-guard]
related_components: [OVRFLO web]
---

# Discovery security-guard exemptions must be exact-path only

## Problem

U3 review hardened the RPC discovery scanner, then found banned-pattern /
security-lint exemptions for discovery owners were too broad. Nested paths that
merely *looked* like `web/lib/discovery` could escape guards meant only for the
real discovery owner and the deployment verifier.

## Symptoms

- Prefix-style path matching treated nested lookalikes as exempt
- False-ready hydration and unchecked receipt decoding needed separate
  hardening once the exemption surface was tightened

## What Didn't Work

Exempting "anything under a discovery-ish path." Exemptions are trust
exceptions; fuzzy matching recreates the risk the ban exists to stop.

## Solution

Only the exact `web/lib/discovery` owner and the exact deployment verifier are
exempt. Nested similarly named directories remain covered. False-ready hydration
and receipt decoding were hardened in the same review-fix pass (Codex U3; merged in PR #3).

Regression coverage lives in `web/tests/scripts/banned-patterns.test.ts`
(a synthetic nested fixture path under the test harness is still banned;
it is not a real source tree directory).

## Why This Works

Discovery is allowed to touch raw RPC primitives other web code must not. That
privilege is path-identity based, not name-similarity based.

## Prevention

- Add a nested-path negative test whenever a new exemption is introduced
- Prefer exact string path equality over `includes("discovery")`

## Related Issues

- [Live discovery cutover must keep partial and stale reads fail-closed](../integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md)
- [Stream discovery is a candidate set, not an authority](./indexer-is-a-discovery-hint-not-an-authority.md)
- Captured from Codex U3 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
