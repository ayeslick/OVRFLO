import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// R36/KTD8: Ponder indexes Sablier stream events and borrow demand, and nothing
// else. Liquidity positions, loans, listings and pool shares are protocol state
// and are read from the protocol — routing any of them through the indexer
// would make an offchain mirror load-bearing for money the user can act on.
//
// This is a guard, not a change: the scope was already correct. It exists
// because "we decided not to index that" is invisible at review time — a new
// handler looks like a feature, not like a boundary being crossed.

const PONDER_ROOT = resolve(__dirname, "../../../tools/ponder");
const read = (p: string) => readFileSync(resolve(PONDER_ROOT, p), "utf8");

describe("indexer scope (R36)", () => {
  it("indexes exactly the three tables the scope allows", () => {
    const schema = read("ponder.schema.ts");
    const tables = [...schema.matchAll(/onchainTable\("(\w+)"/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(["asset", "borrow_events", "sablier_streams"]);
  });

  it("registers no handler for protocol state the app reads from the chain", () => {
    const handlers = ["src/SablierV2LockupLinear.ts", "src/OVRFLOLending.ts"]
      .map(read)
      .join("\n");
    const events = [...handlers.matchAll(/ponder\.on\("([^"]+)"/g)].map((m) => m[1]);

    // The one lending event indexed is borrow demand — historical activity, not
    // state. Anything about liquidity, listings or pool shares belongs on chain.
    const lendingEvents = events.filter((e) => e.startsWith("OVRFLOLending:"));
    expect(lendingEvents).toEqual(["OVRFLOLending:BorrowerLoanPoolCreated"]);

    for (const banned of ["LiquiditySupplied", "LiquidityWithdrawn", "SaleListing", "LoanPoolShare", "LoanRepaid"]) {
      expect(handlers).not.toContain(banned);
    }
  });

  it("exposes no arbitrary-query surface", () => {
    // R38: `client()` mounts SQL over HTTP and `graphql()` mounts a query
    // language. Either one re-opens the surface the fixed endpoints replaced.
    const api = read("src/api/index.ts");
    expect(api).not.toMatch(/\bclient\(\{/);
    expect(api).not.toMatch(/\bgraphql\(\{/);
    expect(api).not.toContain('"/sql');
  });

  it("serves only the two reads the app performs", () => {
    const api = read("src/api/index.ts");
    const routes = [...api.matchAll(/app\.get\("([^"]+)"/g)].map((m) => m[1]).sort();
    expect(routes).toEqual(["/demand", "/streams"]);
  });
});
