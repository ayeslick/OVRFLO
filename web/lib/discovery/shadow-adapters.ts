import { decodeEventLog, type Address, type Hex } from "viem";
import { ovrfloAbi, ovrfloLendingAbi } from "../abis";
import {
  isFreshReady,
  loadingOutcome,
  partialOutcome,
  readFailure,
  readyOutcome,
  refreshFailureOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
  type ReadOutcomeMetadata,
} from "../read-outcome";
import type { VaultRegistryOutcome } from "./stream-discovery";

export type ShadowBatchResult<T> =
  | { status: "success"; value: T }
  | { status: "failure"; error: unknown; entityId?: string | number | bigint }
  | { status: "excluded"; reason: string };

type AdaptBatchInput<T> = {
  source: string;
  results: readonly ShadowBatchResult<T>[];
  metadata?: ReadOutcomeMetadata;
  loading?: boolean;
  queryError?: unknown;
  previous?: ReadOutcome<readonly T[]>;
};

export function adaptBatch<T>({
  source,
  results,
  metadata = {},
  loading = false,
  queryError,
  previous,
}: AdaptBatchInput<T>): ReadOutcome<readonly T[]> {
  if (loading) {
    if (previous?.status === "ready" || previous?.status === "partial") {
      if (previous.freshness === "stale") return previous;
      if (previous.status === "ready") {
        return readyOutcome(previous.data, previous.metadata, "stale", previous.failures);
      }
      return partialOutcome(previous.data, previous.failures, previous.metadata, "stale");
    }
    return loadingOutcome(previous?.data, metadata);
  }

  if (queryError !== undefined && queryError !== null) {
    return refreshFailureOutcome(
      previous,
      readFailure(source, "transport", queryError, { retryable: true }),
    );
  }

  const data: T[] = [];
  const failures: ReadFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === "success") {
      data.push(result.value);
    } else if (result.status === "failure") {
      failures.push(
        readFailure(source, "subcall", result.error, {
          index,
          entityId: result.entityId,
          retryable: true,
        }),
      );
    }
  });

  if (failures.length === 0) return readyOutcome(data, metadata);
  if (data.length > 0) return partialOutcome(data, failures, metadata);
  return unavailableOutcome(failures, metadata);
}

export type BlockPinnedHydrationPlan = {
  blockNumber: bigint;
  requestedCandidateIds: readonly bigint[];
  chunks: readonly (readonly bigint[])[];
  candidateLimitHit: boolean;
};

export function planBlockPinnedHydration({
  candidateIds,
  blockNumber,
  maxCandidates,
  chunkSize,
}: {
  candidateIds: readonly bigint[];
  blockNumber: bigint;
  maxCandidates: number;
  chunkSize: number;
}): BlockPinnedHydrationPlan {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates <= 0) {
    throw new Error("maxCandidates must be a positive safe integer");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive safe integer");
  }
  if (blockNumber < 0n) throw new Error("blockNumber must be non-negative");

  const requestedCandidateIds = candidateIds.slice(0, maxCandidates);
  const chunks: bigint[][] = [];
  for (let index = 0; index < requestedCandidateIds.length; index += chunkSize) {
    chunks.push(requestedCandidateIds.slice(index, index + chunkSize));
  }
  return {
    blockNumber,
    requestedCandidateIds,
    chunks,
    candidateLimitHit: candidateIds.length > maxCandidates,
  };
}

type HydrationChunk<T> = {
  blockNumber: bigint;
  results: readonly ShadowBatchResult<T>[];
};

type BlockPinnedHydrationData<T> = {
  blockNumber: bigint;
  candidateIds: readonly bigint[];
  values: readonly T[];
};

export function adaptBlockPinnedHydration<T>({
  source,
  plan,
  chunks,
  metadata = {},
}: {
  source: string;
  plan: BlockPinnedHydrationPlan;
  chunks: readonly HydrationChunk<T>[];
  metadata?: ReadOutcomeMetadata;
}): ReadOutcome<BlockPinnedHydrationData<T>> {
  const values: T[] = [];
  const failures: ReadFailure[] = [];
  let resultOffset = 0;

  plan.chunks.forEach((candidateChunk, chunkIndex) => {
    const chunkOffset = resultOffset;
    resultOffset += candidateChunk.length;
    const chunk = chunks[chunkIndex];
    if (!chunk) {
      failures.push(
        readFailure(source, "incomplete", `Hydration chunk ${chunkIndex} did not return`, {
          retryable: true,
        }),
      );
      return;
    }
    if (chunk.blockNumber !== plan.blockNumber) {
      failures.push(
        readFailure(
          source,
          "invalid",
          `Hydration chunk ${chunkIndex} returned block ${chunk.blockNumber} instead of pinned block ${plan.blockNumber}`,
          { retryable: false },
        ),
      );
      return;
    }
    if (chunk.results.length !== candidateChunk.length) {
      failures.push(
        readFailure(
          source,
          "incomplete",
          `Hydration chunk ${chunkIndex} returned ${chunk.results.length} of ${candidateChunk.length} subcalls`,
          { retryable: true },
        ),
      );
    }
    chunk.results.slice(0, candidateChunk.length).forEach((result, resultIndex) => {
      if (result.status === "success") {
        values.push(result.value);
      } else if (result.status === "failure") {
        failures.push(
          readFailure(source, "subcall", result.error, {
            index: chunkOffset + resultIndex,
            entityId: result.entityId ?? candidateChunk[resultIndex],
            retryable: true,
          }),
        );
      } else {
        failures.push(
          readFailure(
            source,
            "invalid",
            `Hydration candidate ${candidateChunk[resultIndex]} cannot be excluded`,
            {
              index: chunkOffset + resultIndex,
              entityId: candidateChunk[resultIndex],
              retryable: false,
            },
          ),
        );
      }
    });
  });
  if (chunks.length > plan.chunks.length) {
    failures.push(
      readFailure(source, "invalid", "Hydration returned more chunks than requested", {
        retryable: false,
      }),
    );
  }
  if (plan.candidateLimitHit) {
    failures.push(
      readFailure(source, "fragmented", "Projected candidate hydration limit reached", {
        retryable: false,
      }),
    );
  }

  const data: BlockPinnedHydrationData<T> = {
    blockNumber: plan.blockNumber,
    candidateIds: plan.requestedCandidateIds,
    values,
  };
  const pinnedMetadata = { ...metadata, blockNumber: plan.blockNumber };
  if (failures.length === 0) return readyOutcome(data, pinnedMetadata);
  if (values.length > 0) return partialOutcome(data, failures, pinnedMetadata);
  return unavailableOutcome(failures, pinnedMetadata);
}

export type ShadowDepth = {
  publicDepth: bigint;
};

export type ShadowRouting = {
  executableDepth: bigint;
  fragmentedDepth: bigint;
  selfExcludedDepth: bigint;
};

export type ShadowHydration = {
  status: "ready" | "fragmented" | "insufficient" | "conservation-failed";
  selectedIds: readonly bigint[];
  selectedDepth: bigint;
};

export type BorrowShadowView = {
  publicDepth: bigint | null;
  borrowEnabled: boolean;
  primaryLabel: "EXECUTABLE LIQUIDITY" | null;
  primaryAmount: bigint | null;
  secondary: Array<{ label: string; amount: bigint; reason: string }>;
  message: string;
};

export function buildBorrowShadowView({
  depth,
  routing,
  hydration,
}: {
  depth: ReadOutcome<ShadowDepth>;
  routing: ReadOutcome<ShadowRouting>;
  hydration: ReadOutcome<ShadowHydration>;
}): BorrowShadowView {
  const publicDepth = "data" in depth && depth.data ? depth.data.publicDepth : null;
  const routingReady = isFreshReady(routing);
  const hydrationReady = isFreshReady(hydration);
  const pinnedBlocks = [
    depth.metadata.blockNumber,
    routing.metadata.blockNumber,
    hydration.metadata.blockNumber,
  ];
  const sharesPinnedBlock =
    pinnedBlocks.every((block): block is bigint => typeof block === "bigint") &&
    pinnedBlocks.every((block) => block === pinnedBlocks[0]);
  const borrowEnabled =
    isFreshReady(depth) &&
    routingReady &&
    hydrationReady &&
    sharesPinnedBlock &&
    hydration.data.status === "ready";

  let message: string;
  if (!isFreshReady(depth)) {
    message =
      depth.status === "loading"
        ? "Loading market liquidity."
        : "Market liquidity is temporarily unavailable.";
  } else if (routing.status === "loading") {
    message = "Liquidity available — preparing routes.";
  } else if (routing.status === "unavailable") {
    message = "Liquidity visible — routing temporarily unavailable.";
  } else if (routing.status === "partial") {
    message = "Liquidity visible — routing is incomplete.";
  } else if (routing.freshness === "stale") {
    message = "Liquidity visible — routing data is stale.";
  } else if (!hydrationReady) {
    message = "Route selected — verifying live liquidity.";
  } else if (!sharesPinnedBlock) {
    message = "Depth, routing, and hydration must share one pinned block.";
  } else if (hydration.data.status === "fragmented") {
    message = "Liquidity is too fragmented for the bounded route.";
  } else if (hydration.data.status !== "ready") {
    message = "Executable liquidity is insufficient.";
  } else {
    message = "Executable liquidity is ready.";
  }

  const secondary: BorrowShadowView["secondary"] = [];
  if (routingReady && publicDepth !== null) {
    secondary.push({
      label: "PUBLIC DEPTH",
      amount: publicDepth,
      reason: "aggregate market liquidity",
    });
    if (routing.data.fragmentedDepth > 0n) {
      secondary.push({
        label: "FRAGMENTED DEPTH",
        amount: routing.data.fragmentedDepth,
        reason: "outside the bounded executable route",
      });
    }
    if (routing.data.selfExcludedDepth > 0n) {
      secondary.push({
        label: "SELF-EXCLUDED DEPTH",
        amount: routing.data.selfExcludedDepth,
        reason: "supplied by the connected borrower",
      });
    }
  }

  return {
    publicDepth,
    borrowEnabled,
    primaryLabel:
      routingReady && hydrationReady && sharesPinnedBlock
        ? "EXECUTABLE LIQUIDITY"
        : null,
    primaryAmount:
      routingReady && hydrationReady && sharesPinnedBlock
        ? routing.data.executableDepth
        : null,
    secondary,
    message,
  };
}

export type PortfolioMetrics = {
  supplied: bigint | null;
  loans: number | null;
  streams: number | null;
  claimable: bigint | null;
};

type PortfolioSourceOutcomes = {
  supplied: ReadOutcome<{ supplied: bigint }>;
  loans: ReadOutcome<{ loans: number }>;
  streams: ReadOutcome<{ streams: number }>;
  claimable: ReadOutcome<{ claimable: bigint }>;
};

export function combinePortfolioSourceOutcomes(
  sources: PortfolioSourceOutcomes,
  metadata: ReadOutcomeMetadata = {},
): ReadOutcome<PortfolioMetrics> {
  const data: PortfolioMetrics = {
    supplied: null,
    loans: null,
    streams: null,
    claimable: null,
  };
  const failures: ReadFailure[] = [];
  let hasUsableSource = false;
  let allFreshReady = true;
  let hasLoadingSource = false;

  const entries = Object.entries(sources) as Array<
    [keyof PortfolioSourceOutcomes, PortfolioSourceOutcomes[keyof PortfolioSourceOutcomes]]
  >;
  for (const [source, outcome] of entries) {
    if (outcome.status === "ready" || outcome.status === "partial") {
      hasUsableSource = true;
      Object.assign(data, outcome.data);
    }
    if (outcome.status === "ready" && outcome.freshness === "fresh") continue;
    allFreshReady = false;
    if (outcome.status === "loading") {
      hasLoadingSource = true;
      failures.push(
        readFailure(source, "incomplete", `${source} is still loading`, {
          retryable: true,
        }),
      );
    } else if (outcome.status === "ready") {
      failures.push(
        readFailure(source, "incomplete", `${source} is stale`, {
          retryable: true,
        }),
      );
    } else {
      failures.push(...outcome.failures);
    }
  }

  if (allFreshReady) return readyOutcome(data, metadata);
  if (hasUsableSource) return partialOutcome(data, failures, metadata);
  if (hasLoadingSource) return loadingOutcome(undefined, metadata);
  return unavailableOutcome(failures, metadata);
}

export type PortfolioShadowView = {
  visible: boolean;
  state: "disconnected" | "unloaded" | "loading" | "populated" | "empty" | "partial" | "unavailable";
  metrics: PortfolioMetrics | null;
  loadAction: { label: "LOAD PORTFOLIO" } | null;
  recoveryAvailable: boolean;
  message: string;
};

type PortfolioShadowInput =
  | { state: "disconnected" }
  | { state: "connected-idle" }
  | {
      state: "connected-started";
      outcome: ReadOutcome<PortfolioMetrics>;
    };

export function buildPortfolioShadowView(
  input: PortfolioShadowInput,
): PortfolioShadowView {
  if (input.state === "disconnected") {
    return {
      visible: false,
      state: "disconnected",
      metrics: null,
      loadAction: null,
      recoveryAvailable: false,
      message: "Connect a wallet to view the portfolio.",
    };
  }
  if (input.state === "connected-idle") {
    return {
      visible: true,
      state: "unloaded",
      metrics: null,
      loadAction: { label: "LOAD PORTFOLIO" },
      recoveryAvailable: false,
      message: "Portfolio values have not been loaded.",
    };
  }
  const { outcome } = input;
  if (outcome.status === "loading") {
    return {
      visible: true,
      state: "loading",
      metrics: null,
      loadAction: null,
      recoveryAvailable: false,
      message: "Loading portfolio.",
    };
  }
  if (outcome.status === "unavailable") {
    return {
      visible: true,
      state: "unavailable",
      metrics: null,
      loadAction: null,
      recoveryAvailable: true,
      message: "Portfolio discovery is unavailable. Recover a known item directly.",
    };
  }
  if (outcome.status === "partial") {
    return {
      visible: true,
      state: "partial",
      metrics: outcome.data,
      loadAction: null,
      recoveryAvailable: true,
      message: "Some portfolio sources are unavailable.",
    };
  }
  const empty =
    outcome.data.supplied === 0n &&
    outcome.data.loans === 0 &&
    outcome.data.streams === 0 &&
    outcome.data.claimable === 0n;
  return {
    visible: true,
    state: empty ? "empty" : "populated",
    metrics: outcome.data,
    loadAction: null,
    recoveryAvailable: false,
    message: empty ? "No portfolio positions found." : "Portfolio loaded.",
  };
}

type RecoveryKind = "liquidity" | "stream" | "loan" | "pool";
type RecoverySource = "manual-id" | "deep-link" | "transaction-hash";

type RecoveryEvidence =
  | { status: "nonexistent" }
  | {
      status: "existing";
      relation: "owner" | "contributor" | "foreign";
      eligible: boolean;
      completed: boolean;
    };

type RecoveryInput = {
  source: RecoverySource;
  candidates: readonly {
    kind: RecoveryKind;
    id: bigint;
    read: ShadowBatchResult<RecoveryEvidence>;
  }[];
  metadata?: ReadOutcomeMetadata;
};

type RecoveryCandidate = {
  kind: RecoveryKind;
  id: bigint;
  status: "nonexistent" | "foreign" | "ineligible" | "completed" | "actionable";
};

type RecoveryData = {
  source: RecoverySource;
  portfolioComplete: false;
  claimAllComplete: false;
  candidates: RecoveryCandidate[];
};

export function buildRecoveryOutcome({
  source,
  candidates,
  metadata = {},
}: RecoveryInput): ReadOutcome<RecoveryData> {
  const recovered: RecoveryCandidate[] = [];
  const failures: ReadFailure[] = [];
  candidates.forEach(({ kind, id, read }, index) => {
    if (read.status === "failure") {
      failures.push(
        readFailure("recovery", "subcall", read.error, {
          index,
          entityId: `${kind}:${id}`,
          retryable: true,
        }),
      );
      return;
    }
    if (read.status === "excluded") return;
    const evidence = read.value;
    let status: RecoveryCandidate["status"];
    if (evidence.status === "nonexistent") status = "nonexistent";
    else if (evidence.relation === "foreign") status = "foreign";
    else if (evidence.completed) status = "completed";
    else if (!evidence.eligible) status = "ineligible";
    else status = "actionable";
    recovered.push({ kind, id, status });
  });

  const data: RecoveryData = {
    source,
    portfolioComplete: false,
    claimAllComplete: false,
    candidates: recovered,
  };
  if (failures.length === 0) return readyOutcome(data, metadata);
  if (recovered.length > 0) return partialOutcome(data, failures, metadata);
  return unavailableOutcome(failures, metadata, data);
}

type RecoveryReceiptLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};

type RecoveryCandidateIdentity = {
  kind: RecoveryKind;
  id: bigint;
};

export function decodeRecoveryCandidatesFromReceipt(
  logs: readonly RecoveryReceiptLog[],
  {
    lendingAddresses,
    vaultAddresses,
  }: {
    lendingAddresses: readonly Address[];
    vaultAddresses: readonly Address[];
  },
): RecoveryCandidateIdentity[] {
  const lendingSet = new Set(lendingAddresses.map((address) => address.toLowerCase()));
  const vaultSet = new Set(vaultAddresses.map((address) => address.toLowerCase()));
  const candidates = new Map<string, RecoveryCandidateIdentity>();
  const bigintArg = (args: unknown, name: string): bigint | undefined => {
    if (typeof args !== "object" || args === null || !(name in args)) return undefined;
    const value = Reflect.get(args, name);
    return typeof value === "bigint" ? value : undefined;
  };
  const add = (kind: RecoveryKind, id: unknown) => {
    if (typeof id !== "bigint" || id <= 0n) return;
    candidates.set(`${kind}:${id}`, { kind, id });
  };

  for (const log of logs) {
    if (log.topics.length === 0) continue;
    const normalizedAddress = log.address.toLowerCase();
    if (lendingSet.has(normalizedAddress)) {
      try {
        const decoded = decodeEventLog({
          abi: ovrfloLendingAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
          strict: true,
        });
        switch (decoded.eventName) {
          case "LiquiditySupplied":
          case "LiquidityWithdrawn":
          case "LiquidityCheckpoint":
          case "StreamSoldToLiquidity":
            add("liquidity", bigintArg(decoded.args, "liquidityId"));
            break;
        }
        switch (decoded.eventName) {
          case "BorrowerLoanPoolCreated":
          case "LoanClosed":
          case "LoanRepaid":
          case "LoanPoolShareClaimed":
            add("loan", bigintArg(decoded.args, "loanId"));
            add("pool", bigintArg(decoded.args, "loanId"));
            break;
        }
        switch (decoded.eventName) {
          case "StreamSoldToLiquidity":
          case "StreamSaleListingPosted":
          case "StreamSaleListingCancelled":
          case "StreamSaleListingTaken":
            add("stream", bigintArg(decoded.args, "streamId"));
            break;
        }
      } catch {
        // Receipt recovery is a narrowing pass over known protocol logs. An
        // unrelated or malformed log is ignored; live reads still decide
        // whether every decoded candidate exists and is actionable.
      }
    } else if (vaultSet.has(normalizedAddress)) {
      try {
        const decoded = decodeEventLog({
          abi: ovrfloAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
          strict: true,
        });
        if (decoded.eventName === "Deposited") {
          add("stream", bigintArg(decoded.args, "streamId"));
        }
      } catch {
        // See the lending-log branch above.
      }
    }
  }

  const kindOrder: Record<RecoveryKind, number> = {
    liquidity: 0,
    loan: 1,
    pool: 2,
    stream: 3,
  };
  return [...candidates.values()].sort(
    (left, right) =>
      kindOrder[left.kind] - kindOrder[right.kind] ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

export type DiscoveryScopeIdentity = {
  account?: Address | null;
  chainId: number;
  factory: Address;
  market?: Address | null;
  aprBps?: number | null;
  modal?: string | null;
};

declare const discoveryScopeBrand: unique symbol;
export type DiscoveryScope = string & { readonly [discoveryScopeBrand]: true };

export function createDiscoveryScope(identity: DiscoveryScopeIdentity): DiscoveryScope {
  const normalize = (value: Address | null | undefined) => value?.toLowerCase() ?? "-";
  return [
    `account:${normalize(identity.account)}`,
    `chain:${identity.chainId}`,
    `factory:${normalize(identity.factory)}`,
    `market:${normalize(identity.market)}`,
    `apr:${identity.aprBps ?? "-"}`,
    `modal:${identity.modal ?? "-"}`,
  ].join("|") as DiscoveryScope;
}

export function acceptScopedResult<T>(
  requested: DiscoveryScope,
  current: DiscoveryScope,
  outcome: ReadOutcome<T>,
):
  | { accepted: true; outcome: ReadOutcome<T> }
  | { accepted: false; failure: ReadFailure } {
  if (requested === current) return { accepted: true, outcome };
  return {
    accepted: false,
    failure: readFailure("scope", "cancelled", "Discovery scope changed before the read completed", {
      retryable: false,
      entityId: requested,
    }),
  };
}

type RegistryChunk = {
  start: number;
  results: readonly ShadowBatchResult<Address>[];
};

export function adaptVaultRegistryChunks({
  expectedCount,
  maxExpectedCount,
  chunkSize,
  chunks,
  metadata = {},
}: {
  expectedCount: number;
  maxExpectedCount: number;
  chunkSize: number;
  chunks: readonly RegistryChunk[];
  metadata?: ReadOutcomeMetadata;
}): ReadOutcome<readonly Address[]> {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    throw new Error("expectedCount must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxExpectedCount) || maxExpectedCount <= 0) {
    throw new Error("maxExpectedCount must be a positive safe integer");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive safe integer");
  }
  if (expectedCount > maxExpectedCount) {
    return unavailableOutcome(
      [
        readFailure(
          "vault-registry",
          "incomplete",
          `Vault registry count ${expectedCount} exceeds read budget ${maxExpectedCount}`,
          { retryable: false },
        ),
      ],
      metadata,
    );
  }

  const slots = new Map<number, ShadowBatchResult<Address>>();
  const failures: ReadFailure[] = [];
  for (const chunk of chunks) {
    if (
      !Number.isSafeInteger(chunk.start) ||
      chunk.start < 0 ||
      chunk.start % chunkSize !== 0 ||
      chunk.results.length > chunkSize
    ) {
      failures.push(
        readFailure("vault-registry", "invalid", `Invalid registry chunk at ${chunk.start}`, {
          retryable: false,
        }),
      );
      continue;
    }
    chunk.results.forEach((result, offset) => {
      const index = chunk.start + offset;
      if (index >= expectedCount || slots.has(index)) {
        failures.push(
          readFailure("vault-registry", "invalid", `Duplicate or out-of-range registry slot ${index}`, {
            index,
            retryable: false,
          }),
        );
      } else {
        slots.set(index, result);
      }
    });
  }

  const vaults: Address[] = [];
  for (let index = 0; index < expectedCount; index++) {
    const result = slots.get(index);
    if (!result) {
      failures.push(
        readFailure("vault-registry", "incomplete", `Registry slot ${index} was not read`, {
          index,
          retryable: true,
        }),
      );
    } else if (result.status === "success") {
      vaults.push(result.value);
    } else if (result.status === "failure") {
      failures.push(
        readFailure("vault-registry", "subcall", result.error, {
          index,
          entityId: index,
          retryable: true,
        }),
      );
    } else {
      failures.push(
        readFailure("vault-registry", "invalid", `Registry slot ${index} cannot be excluded`, {
          index,
          retryable: false,
        }),
      );
    }
  }

  if (failures.length === 0) return readyOutcome(vaults, metadata);
  if (vaults.length > 0) return partialOutcome(vaults, failures, metadata);
  return unavailableOutcome(failures, metadata);
}

export function toVaultRegistryOutcome(
  outcome: ReadOutcome<readonly Address[]>,
): VaultRegistryOutcome {
  if (isFreshReady(outcome)) {
    return { status: "complete", vaults: outcome.data };
  }
  const error =
    outcome.failures.map((failure) => failure.message).join("; ") ||
    (outcome.status === "loading"
      ? "Vault registry is still loading"
      : "Vault registry is not fresh and complete");
  if (outcome.status === "partial" || outcome.status === "ready") {
    return { status: "partial", vaults: outcome.data, error };
  }
  return {
    status: "unavailable",
    ...("data" in outcome && outcome.data ? { vaults: outcome.data } : {}),
    error,
  };
}

export type ShadowRequest =
  | "market-depth"
  | "apr-depth"
  | "routing"
  | "selected-hydration"
  | "lender-positions"
  | "borrower-loans"
  | "demand"
  | "held-streams"
  | "claim-all-corroboration";

export function planAprDepthReads({
  marketOpen,
  borrowOpen,
}: {
  marketOpen: boolean;
  borrowOpen: boolean;
}): number[] {
  if (!marketOpen && !borrowOpen) return [];
  return Array.from({ length: 101 }, (_, index) => index * 100);
}

export function planShadowRequests({
  surface,
  portfolioLoaded,
}: {
  surface: "markets" | "borrow" | "portfolio" | "claim-all";
  portfolioLoaded: boolean;
}): ShadowRequest[] {
  if (surface === "markets") return ["market-depth"];
  if (surface === "borrow") {
    return ["market-depth", "apr-depth", "routing", "selected-hydration"];
  }
  if (surface === "portfolio" && !portfolioLoaded) return [];
  const personal: ShadowRequest[] = [
    "lender-positions",
    "borrower-loans",
    "demand",
    "held-streams",
  ];
  return surface === "claim-all"
    ? [...personal, "claim-all-corroboration"]
    : personal;
}
