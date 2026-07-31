import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ActionIdentity, TouchedResource } from "./actions/types";
import type { BlockIdentity } from "./discovery/types";
import { keyMentionsAny, WAGMI_READ_ROOTS } from "./invalidate";
import type { projectionKeys, ProjectionScopeKey } from "./query-keys";
import { isFreshReady, type ReadOutcome } from "./read-outcome";

const WAGMI_READ_ROOT_SET = new Set<string>(WAGMI_READ_ROOTS);

export type RefreshPlan = {
  matches: (queryKey: readonly unknown[]) => boolean;
  projectionMatches: (queryKey: readonly unknown[]) => boolean;
  resources: readonly TouchedResource[];
};

type ProjectionSelector = Partial<
  Pick<ProjectionScopeKey, "lending" | "kind" | "market" | "aprBps" | "account">
>;
type ProjectionKey = ReturnType<typeof projectionKeys.scope>;

function lower(address: Address): string {
  return address.toLowerCase();
}

function projectionSelector(resource: TouchedResource): ProjectionSelector[] {
  switch (resource.kind) {
    case "contract":
      return [];
    case "market-depth":
      return [{
        lending: resource.lending,
        kind: "market-apr",
        market: resource.market,
        ...(resource.aprBps === undefined ? {} : { aprBps: resource.aprBps }),
      }];
    case "liquidity-position":
      // A position ID does not encode market/APR. Reconcile the already-known
      // active scopes for this lending instead of guessing a historical scope.
      return [{ lending: resource.lending }];
    case "loan":
      return [
        { lending: resource.lending, kind: "lender" },
        { lending: resource.lending, kind: "borrower" },
        { lending: resource.lending, kind: "demand" },
        // Closing a loan also consumes its backing stream. The loan ID does
        // not encode the stream ID, so reconcile every already-active stream
        // scope instead of guessing or waiting for indexer convergence.
        { kind: "stream" },
      ];
    case "stream":
      return [{ kind: "stream" }];
    default:
      return [];
  }
}

function resourceContracts(resource: TouchedResource): Address[] {
  switch (resource.kind) {
    case "contract":
      return [resource.address];
    case "market":
      return [resource.vault, resource.market];
    case "market-depth":
    case "liquidity-position":
    case "loan":
      return [resource.lending];
    case "stream":
      return [resource.sablier];
    case "nft-approval":
      return [resource.token];
    case "token-balance":
    case "allowance":
      return [resource.token];
  }
}

function isProjectionKey(queryKey: readonly unknown[]): queryKey is ProjectionKey {
  return (
    queryKey[0] === "projection" &&
    typeof queryKey[2] === "number" &&
    typeof queryKey[6] === "string"
  );
}

function selectorMatches(key: ProjectionKey, selector: ProjectionSelector): boolean {
  const lending = key[5];
  const kind = key[6];
  const market = key[7];
  const aprBps = key[8];
  const account = key[9];
  return (
    (selector.lending == null || lending === lower(selector.lending)) &&
    (selector.kind === undefined || kind === selector.kind) &&
    (selector.market == null || market === lower(selector.market)) &&
    // A key with a null aprBps is a whole-market projection; it contains every
    // tick, so any tick-scoped selector staleness applies to it as well.
    (selector.aprBps == null || aprBps == null || aprBps === selector.aprBps) &&
    (selector.account == null || account === lower(selector.account))
  );
}

export function buildRefreshPlan(
  resources: readonly TouchedResource[],
  identity: ActionIdentity,
): RefreshPlan {
  const contracts = new Set(resources.flatMap(resourceContracts).map(lower));
  const projectionSelectors = resources.flatMap(projectionSelector);
  const projectionMatches = (queryKey: readonly unknown[]) => {
    if (!isProjectionKey(queryKey) || queryKey[2] !== identity.chainId) return false;
    return projectionSelectors.some((selector) => selectorMatches(queryKey, selector));
  };
  const matches = (queryKey: readonly unknown[]) =>
    WAGMI_READ_ROOT_SET.has(String(queryKey[0]))
      ? keyMentionsAny(queryKey, contracts)
      : projectionMatches(queryKey);
  return { matches, projectionMatches, resources };
}

function isReadOutcome(value: unknown): value is ReadOutcome<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "status" in value &&
    "metadata" in value &&
    "failures" in value
  );
}

/**
 * Executes one targeted reconciliation cycle.
 *
 * `captureHead` is called exactly once. Projection outcomes must be fresh and
 * complete through that captured post-receipt head; raw wagmi reads are
 * accepted only when their throwing refetch succeeds.
 */
export async function refreshQueryResources(
  queryClient: QueryClient,
  plan: RefreshPlan,
  options: {
    captureHead: () => Promise<BlockIdentity>;
    hydrate: (resource: TouchedResource, head: BlockIdentity) => Promise<void>;
  },
): Promise<BlockIdentity> {
  const head = await options.captureHead();
  const cache = queryClient.getQueryCache();
  await queryClient.refetchQueries(
    {
      type: "all",
      predicate: (query) => plan.matches(query.queryKey),
    },
    { throwOnError: true },
  );
  await Promise.all(plan.resources.map((resource) => options.hydrate(resource, head)));

  const matched = cache
    .getAll()
    .filter((query) => plan.matches(query.queryKey));
  for (const query of matched) {
    if (query.state.status === "error") {
      throw query.state.error ?? new Error("Critical resource refresh failed");
    }
    if (!isProjectionKey(query.queryKey) || !isReadOutcome(query.state.data)) continue;
    const outcome = query.state.data;
    if (
      !isFreshReady(outcome) ||
      outcome.metadata.blockNumber === undefined ||
      outcome.metadata.blockNumber < head.number
    ) {
      throw new Error("Critical projection resource is not fresh and ready through the captured head");
    }
  }
  return head;
}
