import type { Address } from "viem";
import { ponderUrl } from "./config";
import { DEMAND_WINDOW_SECONDS, type BorrowDemandEvent } from "./demand";

// R38/M-8: this used to speak SQL to the indexer through `@ponder/client`,
// which meant the deployed surface had to be an arbitrary-query endpoint. It is
// now two fixed reads over plain fetch, so the service can expose exactly what
// the app consumes and nothing else.
//
// `NEXT_PUBLIC_PONDER_URL` historically pointed at the `/sql` mount. The path is
// stripped here so an existing configured value keeps working against the new
// routes rather than silently 404ing.
function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/sql\/?$/, "").replace(/\/$/, "")}${path}`;
}

async function readJson<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    // Distinguish the one failure a caller can act on differently: throttling
    // is transient and worth retrying, anything else is not.
    if (response.status === 429) throw new Error(`${what} is rate limited — retry shortly.`);
    throw new Error(`${what} request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

// Trailing-window borrow events for one market. Throws when the indexer is
// unconfigured or unreachable — the demand column must render "no data"
// distinctly from "genuinely zero borrows", so the error has to reach the hook
// instead of collapsing into an empty array.
export async function fetchBorrowDemand(
  market: Address,
  nowSeconds: bigint,
  baseUrl = ponderUrl,
): Promise<BorrowDemandEvent[]> {
  if (!baseUrl) throw new Error("Demand indexer is not configured.");

  const since = (nowSeconds - DEMAND_WINDOW_SECONDS).toString();
  const url = endpoint(baseUrl, `/demand?market=${market.toLowerCase()}&since=${since}`);

  const { events } = await readJson<{
    events: { aprBps: number; amount: string; borrower: Address; blockTimestamp: string }[];
  }>(url, "Borrow demand");

  return events.map((event) => ({
    aprBps: event.aprBps,
    amount: BigInt(event.amount),
    borrower: event.borrower,
    blockTimestamp: BigInt(event.blockTimestamp),
  }));
}

/**
 * The stream ids that may belong to `user`.
 *
 * Ids only, deliberately. After R37 every value the app displays or acts on is
 * read from Sablier, so returning the indexer's copy of recipient, sender,
 * asset, end time or amounts would be shipping data the client is required to
 * ignore — and inviting a future caller to trust it.
 *
 * R44: throws rather than returning [] when unconfigured, matching
 * fetchBorrowDemand. An empty array is indistinguishable from "this user holds
 * no streams", so the unconfigured case used to render a confident empty list.
 */
export async function fetchHeldStreamIds(user: Address, baseUrl = ponderUrl, limit = 100): Promise<bigint[]> {
  if (!baseUrl) throw new Error("Stream discovery indexer is not configured.");

  const url = endpoint(baseUrl, `/streams?owner=${user.toLowerCase()}&limit=${limit}`);
  const { streamIds } = await readJson<{ streamIds: string[] }>(url, "Stream discovery");
  return streamIds.map((id) => BigInt(id));
}
