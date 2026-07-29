import { Hono } from "hono";
import { db } from "ponder:api";
import { and, desc, eq, gte } from "ponder";
import { borrowEvent, sablierStream } from "ponder:schema";

// R38/M-8: the browser used to reach this service through `client()`, which
// mounts an arbitrary-SQL endpoint at /sql/*. That is a query language exposed
// to the public internet — `web` is a static export, so there is no server side
// to hold a credential and nothing between a caller and the database but
// whatever the SQL layer itself refuses.
//
// It is replaced by the two reads the app actually performs. Custom REST
// endpoints are Ponder's documented pattern for this, and the `db` handle from
// `ponder:api` is read-only by construction — a stronger guarantee than
// anything this file could add on top.
//
// "Not directly reachable" in the requirement is read as "narrowed to a fixed
// surface". These endpoints stay public: they serve public chain state, and a
// static export has no way to authenticate. What changes is that a caller can
// no longer ask arbitrary questions.
//
// The unconsumed graphql() mount is gone too — nothing in web/ ever queried it,
// and it was a second arbitrary-query surface with the same problem.

const app = new Hono();

// Origin allowlist. Browser-enforced, and the Origin header is client-supplied,
// so this bounds casual cross-site use rather than authenticating anyone. It is
// defence in depth; the rate limit below and the statement timeout configured on
// the database connection are what actually bound abuse.
const ALLOWED_ORIGINS = (process.env.PONDER_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ error: "origin not allowed" }, 403);
  }
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  await next();
});

// Fixed-window rate limit, per client address. In-memory, so it bounds a single
// instance only — a multi-instance deployment needs a shared counter, and that
// belongs in front of this service rather than inside it.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = Number(process.env.PONDER_RATE_LIMIT ?? 120);
const hits = new Map<string, { count: number; resetAt: number }>();

app.use("*", async (c, next) => {
  const key =
    c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else if (entry.count >= MAX_REQUESTS) {
    return c.json({ error: "rate limit exceeded" }, 429);
  } else {
    entry.count += 1;
  }

  // Bound the map: without this it grows with every distinct client address
  // seen, which is a slow leak on a long-running process.
  if (hits.size > 10_000) {
    for (const [seen, window] of hits) if (now > window.resetAt) hits.delete(seen);
  }

  await next();
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_STREAM_LIMIT = 500;

// Stream discovery. Returns ids only — every value the app displays or acts on
// is read from Sablier (R37), so returning more would ship data the client is
// required to ignore, and invite a future caller to trust it.
app.get("/streams", async (c) => {
  const owner = c.req.query("owner");
  if (!owner || !ADDRESS.test(owner)) return c.json({ error: "owner must be an address" }, 400);

  const requested = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_STREAM_LIMIT) : 100;

  const rows = await db
    .select({ streamId: sablierStream.streamId })
    .from(sablierStream)
    .where(
      and(
        eq(sablierStream.recipient, owner.toLowerCase() as `0x${string}`),
        eq(sablierStream.canceled, false),
        eq(sablierStream.depleted, false),
      ),
    )
    .orderBy(desc(sablierStream.streamId))
    .limit(limit);

  return c.json({ streamIds: rows.map((row) => String(row.streamId)) });
});

// Borrow demand: historical activity, not protocol state. This is the one thing
// the indexer is genuinely the right source for — reading it from the chain
// would mean walking logs, which is what an indexer exists to avoid.
app.get("/demand", async (c) => {
  const market = c.req.query("market");
  const since = c.req.query("since");
  if (!market || !ADDRESS.test(market)) return c.json({ error: "market must be an address" }, 400);
  if (!since || !/^\d+$/.test(since)) return c.json({ error: "since must be a unix timestamp" }, 400);

  const rows = await db
    .select({
      aprBps: borrowEvent.aprBps,
      amount: borrowEvent.amount,
      borrower: borrowEvent.borrower,
      blockTimestamp: borrowEvent.blockTimestamp,
    })
    .from(borrowEvent)
    .where(
      and(
        eq(borrowEvent.market, market.toLowerCase() as `0x${string}`),
        gte(borrowEvent.blockTimestamp, BigInt(since)),
      ),
    );

  return c.json({
    events: rows.map((row) => ({
      aprBps: Number(row.aprBps),
      amount: String(row.amount),
      borrower: row.borrower,
      blockTimestamp: String(row.blockTimestamp),
    })),
  });
});

export default app;
