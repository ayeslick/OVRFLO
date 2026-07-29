---
title: Fail the build on missing security config, never substitute a default
date: 2026-07-29
category: best-practices
module: web/scripts/build-csp.mjs, web/scripts/csp-hash-inline.mjs
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - A build step generates security headers or other deploy-target configuration
  - Environment-derived origins are baked into a static artifact at build time
  - Choosing between a fallback default and a hard failure for missing config
tags: [csp, static-export, build-config, fail-closed, next-js, deploy]
---

# Fail the build on missing security config, never substitute a default

## Context

`web` ships as a static export, so `next.config.ts`'s `headers()` API is a no-op
— a real CSP has to be emitted as deploy-target configuration. `build-csp.mjs`
generates `vercel.json` and `public/_headers` from the same `NEXT_PUBLIC_*`
origins the browser bundle embeds.

When those origins were missing, the script substituted `rpc.ankr.com` and
`localhost`. A production deploy could therefore ship a CSP that **blocked its
own RPC and indexer** — and the build stayed green throughout (finding M-17,
requirement R29).

## Guidance

**Missing security-relevant configuration fails the build. The fallback is
opt-in, never opt-out.**

```
Local build that genuinely wants the defaults:  CSP_ALLOW_FALLBACKS=1 npm run build
Everything else:                                 missing origins → build fails
```

The asymmetry is the whole design: the person who *wants* the fallback knows
they want it and can say so in one environment variable. The person who
*forgot* the origin does not know they forgot — that is what forgetting is —
so they cannot be relied on to opt out of a silent substitution.

Two related rules from the same script:

- **`script-src` carries no origins and no `'unsafe-inline'`.** Inline-script
  hashes are added by a separate post-build step, so the policy never widens to
  accommodate build output.
- **Respect the artifact pipeline's ordering.** `csp-hash-inline.mjs` must run
  *after* `next build`, because `build-csp.mjs` writes `public/_headers` and
  Next copies that file into `out/` during export. A hash computed before the
  build could never match the HTML it guards. The build script encodes the
  order explicitly:

```
npm run typegen && node scripts/build-csp.mjs && next build
  && node scripts/csp-hash-inline.mjs && node scripts/verify-static-export.mjs
```

## Why This Matters

A fallback inverts what a green build **means**. The build's job is to certify
"this artifact is deployable." A silent substitution downgrades that to "this
artifact is deployable *somewhere*, possibly not where you are about to put
it" — while the exit code stays 0 and nothing in the output says which.

For a CSP the consequences land in the worst possible place. The failure does
not appear at build time, or in a smoke test, or in any server log. It appears
**in the user's browser**, as requests refused by a policy, on a deploy that
passed every check — maximally far from the person who caused it and from the
information needed to diagnose it. A misconfigured origin becomes an outage that
looks like a wallet bug.

Defaults are the right instinct for *developer convenience* configuration and
the wrong one for anything that constrains what the shipped artifact may talk
to. The test is simple: **if getting this value wrong produces a broken deploy
rather than a broken developer experience, it has no default.**

The ordering rule generalizes past CSP: whenever step A generates an input that
a framework *copies* into the build output, any step that must agree with the
final output has to run after the copy. Reasoning about "which file do I edit"
is not enough — the question is when the framework snapshots it.

## When to Apply

- Generating CSP, CORS, HSTS, or any deploy-target header from environment
- Baking an allowlist, endpoint, or key ID into a static artifact
- Any build script currently written with `??` or `||` around a
  security-relevant value — that operator is where a silent substitution lives

## Examples

**Rejected — plausible default, green build, broken deploy:**

```js
const rpcOrigin = originOf(process.env.NEXT_PUBLIC_RPC_URL) ?? "https://rpc.ankr.com";
```

**Adopted — fail loudly, with a named escape hatch:**

```js
// R29/M-17: this used to substitute rpc.ankr.com and localhost when the
// origins were missing, so a deploy could ship a CSP that blocked its own
// RPC and indexer — silently, because the build stayed green. Missing
// origins now fail the build. Local builds that genuinely want the
// fallbacks opt in with CSP_ALLOW_FALLBACKS=1; forgetting it fails loudly
// rather than shipping something broken.
```

Verified in both directions: the production build **fails** without origins and
succeeds with them, exporting cleanly with the inline scripts hashed.

## Related

- [Narrow the Ponder read surface to the app's queries](../architecture-patterns/narrow-the-ponder-read-surface-to-the-app-queries.md) — the other half of "a static export has no server side to hold anything"
- [The indexer is a discovery hint, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md) — the same fail-closed rule applied to a runtime read
- [Anvil forge script broadcast out of funds](../integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md) — the neighbouring class of build/deploy toolchain trap
