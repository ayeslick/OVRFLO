---
title: Deployable builds must reject the local runtime profile
date: 2026-07-31
category: security-issues
module: web/lib/config.ts
problem_type: security_issue
component: tooling
symptoms:
  - "A local-profile build could activate inside a deployable/production packaging path"
  - "Production fail-closed address and artifact checks were skipped when the profile stayed local"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [fail-closed, runtime-profile, deployment, build-guard, web]
related_components: [OVRFLO web]
---

# Deployable builds must reject the local runtime profile

## Problem

Codex U1 review found that the local runtime profile could still activate in a
deployable production build. Local mode intentionally relaxes production
fail-closed checks, so shipping that profile meant anchors and required env
could slip through packaging.

## Symptoms

- `NEXT_PUBLIC_RUNTIME_PROFILE=local` combined with a deployable build marker
  still resolved to local
- Production-only required-address / zero-address guards never ran for that
  build

## What Didn't Work

Treating `NODE_ENV` or Vercel env alone as enough. The runtime profile is an
explicit operator choice; without a hard reject, local could ride along into a
packaged artifact.

## Solution

`parseProfile()` rejects local when a deployable production signal is present:

```52:57:web/lib/config.ts
  if (
    raw === "local" &&
    (env.vercelEnv === "production" || env.deployableBuild === "1")
  ) {
    throw new Error("The local runtime profile cannot activate in a deployable production build");
  }
```

## Why This Works

Local is for forks and developer convenience. Deployable builds are the trust
boundary for mainnet anchors. Crossing those modes is a config error, not a
runtime fallback.

## Prevention

- Keep a focused test that a deployable build with local profile throws before
  packaging
- Never soften this guard for CI convenience; use an explicit local packaging
  path instead

## Related Issues

- [Fail the build on missing security config](../best-practices/fail-the-build-on-missing-security-config.md)
- Captured from Codex U1 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
