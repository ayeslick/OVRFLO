---
title: Narrow the Ponder read surface to the app's queries, and check the framework before hardening it
date: 2026-07-29
category: architecture-patterns
module: tools/ponder/src/api/index.ts
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - A Ponder indexer is read directly by a browser client
  - The frontend is a static export with nowhere to hold a credential
  - Adding rate limits, timeouts, or access control to a framework-provided service
tags: [ponder, hono, drizzle, indexer, attack-surface, read-only, statement-timeout]
related_components: [Ponder]
---

# Narrow the Ponder read surface to the app's queries, and check the framework before hardening it

## Context

`web` builds as a static export (`output: "export"` in `web/next.config.ts`), so
there is no server side to hold a credential and nothing between a caller and
the indexer's database but whatever the query layer itself refuses.

The browser reached the indexer through `@ponder/client`, which mounts an
**arbitrary-SQL endpoint** at `/sql/*`. A `graphql()` mount was also present —
a second arbitrary-query surface that nothing in `web/` ever queried. Audit
finding M-8 (requirement R38) called for narrowing this.

## Guidance

**Replace the arbitrary-query mounts with the fixed set of reads the app
actually performs.** Two endpoints replaced both mounts
(`tools/ponder/src/api/index.ts`):

- `GET /streams?owner=&limit=` — stream ids only, capped at 500
- `GET /demand?market=&since=` — trailing-window borrow events

Both validate their address and timestamp parameters before touching the
database, and both are built with the **Drizzle query builder** against
`ponder:schema` rather than hand-written SQL.

Read "not directly reachable" as **"narrowed to a fixed surface,"** not
"authenticated." These endpoints serve public chain state and a static export
has no way to authenticate. What changes is that a caller can no longer ask
arbitrary questions.

**Check what the framework already guarantees before building on top of it.**
Consulting Ponder's documentation changed this implementation twice:

1. Custom REST endpoints in the project's API entrypoint
   (`tools/ponder/src/api/index.ts` here) are Ponder's **documented** pattern,
   so removing the default mounts is idiomatic rather than a workaround.
2. The `db` handle from `ponder:api` is **read-only by construction** — a
   stronger guarantee than anything this file could add. Ponder 0.17.1 backs it
   at the driver level: its readonly pool issues
   `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` on connect and
   configures a 30s `statement_timeout` on the pool.

The first draft hand-wrote `sql` templates inside `db.transaction(...)` with
`SET LOCAL statement_timeout`. That is neither documented nor workable against
a read-only handle. It was removed rather than reworked — see below.

**State honestly what each layer does and does not do.** The origin allowlist is
browser-enforced and the `Origin` header is client-supplied, so it bounds casual
cross-site use and authenticates nobody. The rate limit is in-memory, so it
bounds a single instance; a multi-instance deployment needs a shared counter,
and that belongs in front of the service rather than inside it. Both limitations
are written at their definitions.

## Why This Matters

**Do not ship a control that looks like a control.** A JavaScript-side timer
does not cancel a running query — it abandons a promise while the database keeps
working. Shipping that as "the statement timeout" would have been worse than
having none, because the requirement would read as satisfied and nobody would
add the real one. The timeout belongs on the database connection
(`statement_timeout` via `DATABASE_URL` options, or the host's configuration),
and it was recorded as a maintainer verification step rather than faked in
application code.

The general form: **a security control's value is entirely in whether it
actually fires.** A missing control is a known gap; a decorative one is a gap
that has been marked closed. When you cannot implement a control at the layer
where it works, say so in the record instead of implementing it where it
doesn't.

**Unconsumed surface is pure liability.** The `graphql()` mount cost nothing to
remove because nothing used it, and every day it stayed up it was a second
arbitrary-query path into the same database. Default mounts that arrive with a
framework are still surface you own.

**Framework guarantees beat hand-rolled ones** — they are enforced at the
connection rather than at each call site, they cannot be bypassed by the next
endpoint someone adds, and they do not drift when this file is edited. Reading
the docs before hardening is not diligence theatre; here it deleted code and
strengthened the result at the same time.

## When to Apply

- Any Ponder or indexer service reachable from a browser
- Before adding transactions, timeouts, or connection tuning to a
  framework-managed database handle — check what the handle already is
- When a requirement names a control you cannot implement where it belongs

## Examples

**Removed — arbitrary query language on the public internet:**

```ts
import { client, graphql } from "ponder";
app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));
```

**Adopted — a fixed read, validated, capped, and built with Drizzle:**

```ts
app.get("/streams", async (c) => {
  const owner = c.req.query("owner");
  if (!owner || !ADDRESS.test(owner)) return c.json({ error: "owner must be an address" }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), MAX_STREAM_LIMIT);
  const rows = await db.select({ streamId: sablierStream.streamId }).from(sablierStream)
    .where(and(eq(sablierStream.recipient, owner.toLowerCase() as `0x${string}`),
               eq(sablierStream.canceled, false), eq(sablierStream.depleted, false)))
    .orderBy(desc(sablierStream.streamId)).limit(limit);
  return c.json({ streamIds: rows.map((row) => String(row.streamId)) });
});
```

**Note:** Ponder's `/status` route is mounted by the framework rather than by
this Hono app, so it survived the rewrite — which is why the staleness signal
needed no new endpoint.

## Related

- [The indexer is a discovery hint, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md) — the client-side half of the same trust boundary
- [Anchor indexer staleness to chain head](../integration-issues/anchor-indexer-staleness-to-chain-head.md) — the consumer of the framework-mounted `/status`
- [Ponder factory address export order bootstrap](../integration-issues/ponder-factory-address-export-order-bootstrap-20260727.md) — the local bootstrap constraints on this service
