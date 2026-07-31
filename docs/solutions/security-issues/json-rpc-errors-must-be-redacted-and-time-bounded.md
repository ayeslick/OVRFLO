---
title: JSON-RPC errors must be redacted and time-bounded
date: 2026-07-31
category: security-issues
module: web/lib/discovery/log-scanner.ts, tools/scripts/write-deployment-artifact.mjs
problem_type: security_issue
component: tooling
symptoms:
  - "Provider-controlled JSON-RPC error strings could surface URLs or credentials"
  - "Unbounded RPC timeouts hung verification or discovery retries"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [rpc, redaction, timeout, credentials, discovery, deployment-artifact]
related_components: [OVRFLO web]
---

# JSON-RPC errors must be redacted and time-bounded

## Problem

U1 review found RPC error paths could leak provider URLs/credentials into
logs or UI, and timeouts were not bounded enough for verification/discovery
retries.

## Symptoms

- Transport failure messages included raw `https://…` endpoints or bearer-like
  tokens
- Timeout storms blocked packaging or discovery without a hard retry budget

## What Didn't Work

Passing `error.message` straight through. Providers control those strings; they
are not a safe display channel.

## Solution

Redact sensitive substrings before surfacing failures, and bound timeout
retries (bisection + capped retries in the log scanner):

```611:619:web/lib/discovery/log-scanner.ts
function redactSensitiveText(message: string): string {
  return message
    .replace(/\bhttps?:\/\/[^\s)"']+/gi, "[redacted-url]")
    .replace(/\b(wss?):\/\/[^\s)"']+/gi, "[redacted-url]")
    // ...
    .replace(/\bbearer(?:\s+|=)[^"'\s,;}]+/gi, "Bearer [redacted]");
```

Deployment-artifact writing applies the same redaction discipline for
provider-controlled JSON-RPC errors (covered by
`web/tests/scripts/deployment-artifact.test.ts`).

## Why This Works

Failures stay diagnosable (`[redacted-url]`, transport kind) without copying
secrets into CI logs, screenshots, or support transcripts. Bounded retries keep
fail-closed behavior reachable.

## Prevention

- Any new RPC failure path must call a shared redactor before user/CI output
- Add regression tests that assert credentials never appear in surfaced messages

## Related Issues

- [RPC API key exposed in Anvil process arguments](./rpc-api-key-exposed-in-anvil-process-arguments.md)
- Captured from Codex U1 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
