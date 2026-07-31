---
title: Vercel verifier must recompute hashes from packaged HTML
date: 2026-07-31
category: security-issues
module: web/scripts/verify-vercel-output.mjs
problem_type: security_issue
component: tooling
symptoms:
  - "CSP inline-script hashes could pass verification against stale recorded values"
  - "Packaged HTML could drift from the hashes embedded in the CSP route"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [csp, vercel, static-export, inline-scripts, build-guard]
related_components: [OVRFLO web]
---

# Vercel verifier must recompute hashes from packaged HTML

## Problem

U1 review found the Vercel output verifier could accept CSP inline-script
hashes that no longer matched the packaged HTML — a stale receipt/hash set
looked green.

## Symptoms

- Verification compared against previously recorded hashes instead of (or
  without) re-hashing the exact packaged static HTML
- A packaging drift could ship with an enforcing CSP that no longer matched
  scripts

## What Didn't Work

Trusting the packaging receipt alone. Receipts are useful digests; they are not
a substitute for hashing the bytes that will be served.

## Solution

`verify-vercel-output.mjs` extracts hashes from the packaged CSP, recomputes
hashes from the packaged static HTML, and requires an exact match:

```38:42:web/scripts/verify-vercel-output.mjs
  const packagedHashes = [...csp.matchAll(/'sha256-[^']+'/g)].map(([hash]) => hash).sort();
  const staticHashes = collectInlineScriptHashes(resolve(outputDir, "static"));
  if (JSON.stringify(packagedHashes) !== JSON.stringify(staticHashes)) {
    throw new Error("verify-vercel-output: CSP hashes do not match packaged inline scripts");
  }
```

## Why This Works

The verifier becomes a property of the artifact under test, not of whatever
hash set was computed earlier in the pipeline.

## Prevention

- Keep `csp-hash-inline` → package → `verify-vercel-output` ordering intact
- Fail closed on localhost CSP and incomplete `script-src` hashes in the same
  verifier

## Related Issues

- [Fail the build on missing security config](../best-practices/fail-the-build-on-missing-security-config.md)
- Captured from Codex U1 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
