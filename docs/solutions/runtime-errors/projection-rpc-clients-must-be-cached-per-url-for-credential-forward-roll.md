---
title: Projection RPC clients must be cached per URL for credential forward-roll
date: 2026-07-31
category: runtime-errors
module: web/hooks/useProjectionSync.ts
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "getProjectionClient pinned every discovery request to the transport created at first render"
  - "A credential forward-roll or env URL change required a full page reload to take effect"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [projection-client, rpc, credential-forward-roll, singleton, discovery]
related_components: [OVRFLO web]
---

# Projection RPC clients must be cached per URL for credential forward-roll

## Problem

U11 PR review found `primaryClient` / `verifierClient` were fire-once module
singletons. After first render, `getProjectionClient()` kept using the
original transport even when `historicalRpcUrl` or the verifier URL changed
(credential forward-roll — see `docs/operations/rpc-credential-forward-roll.md`).

## Symptoms

- Dev/HMR or env swaps left discovery stuck on the old RPC endpoint
- Future same-code server ports would inherit the same stale-singleton bug

## What Didn't Work

Module-level `let client = create…()` initialized once. Production static
export bakes `NEXT_PUBLIC_*` at build time, so the worst production case is a
new bundle — but the bug is still real for local and for any runtime that can
rotate URLs without reload.

## Solution

Cache clients in a `Map` keyed by URL; resolve the current URL on every
`getProjectionClient()` call:

```29:47:web/hooks/useProjectionSync.ts
// Cached per URL rather than as bare singletons: a credential forward-roll
// (docs/operations/rpc-credential-forward-roll.md) or an env change must not
// leave every later getProjectionClient() call silently pinned to the
// transport that was active at first render.
const clientsByUrl = new Map<string, ProjectionReadClient>();

function clientFor(url: string): ProjectionReadClient {
  let client = clientsByUrl.get(url);
  if (!client) {
    client = createProjectionReadClient(
      createPublicClient({
        chain: mainnet,
        transport: createHistoricalTransport(url),
      }),
    );
    clientsByUrl.set(url, client);
  }
  return client;
}
```

## Why This Works

The cache key is the credential/endpoint identity. Rotating the URL naturally
misses the old entry and builds a fresh client without forcing a remount.

## Prevention

- Never hold long-lived RPC clients as unkeyed module singletons when the URL
  can change
- Cite the forward-roll ops doc from any new projection transport helper

## Related Issues

- [Live discovery cutover must keep partial and stale reads fail-closed](../integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md)
- Ops: [RPC credential forward-roll](../../operations/rpc-credential-forward-roll.md)
- Captured from Claude U11 review feedback fix (merged in PR #3)
