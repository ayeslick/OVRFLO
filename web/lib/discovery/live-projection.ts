import {
  isAddressEqual,
  type Address,
  type PublicClient,
} from "viem";
import {
  ovrfloFactoryAbi,
  ovrfloLendingAbi,
  sablierLockupAbi,
} from "../abis";
import { SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "../config";
import {
  findDemandCutoffBlock,
  type BorrowDemandEvent,
} from "../demand";
import { loanPoolClaimable, recoveredForClaimable } from "../lending-math";
import {
  claimAllPoolCandidate,
  claimAllStreamCandidate,
  type ClaimAllCandidateId,
} from "../claim-all";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "../read-outcome";
import type { HeldStream, LiquidityPosition, Loan, LoanPool } from "../types";
import {
  adaptBatch,
  adaptBlockPinnedHydration,
  adaptVaultRegistryChunks,
  planBlockPinnedHydration,
  type ShadowBatchResult,
} from "./shadow-adapters";
import { MAX_VAULT_REGISTRY_ENTRIES } from "./limits";
import {
  borrowerLoanTopics,
  conserveMarketApr,
  decodeBorrowerLoanCandidate,
  decodeLiquidityCheckpoint,
  liquidityCheckpointTopics,
  marketAprKey,
  projectBorrowerLoans,
  projectLending,
  type BorrowerLoanCandidate,
  type LendingProjection,
} from "./lending-projection";
import {
  captureHeadSnapshot,
  createViemDiscoveryClient,
  scanLogs,
  type DiscoveryClient,
  type HeadSnapshot,
  type RpcLedger,
} from "./log-scanner";
import type { BlockIdentity } from "./types";
import {
  decodeDepositedOrigin,
  decodeRecipientTransfer,
  depositedTopics,
  discoverStreamCandidates,
  recipientTransferTopics,
} from "./stream-discovery";

const MAX_PROJECTED_CANDIDATES = 10_000;
const PROJECTION_HYDRATION_CHUNK_SIZE = 100;
const DISCOVERY_RANGE_SIZE = 50_000n;

type ContractRead = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
};

export type ProjectionReadClient = DiscoveryClient & {
  readContract(request: ContractRead): Promise<unknown>;
};

export function createProjectionReadClient(
  publicClient: PublicClient,
): ProjectionReadClient {
  return {
    ...createViemDiscoveryClient(publicClient),
    readContract: (request) => publicClient.readContract(request as never),
  };
}

export type MarketLiquidityProjection = {
  projection: LendingProjection;
  positions: readonly LiquidityPosition[];
  aggregateDepth: bigint;
  aggregateByApr: ReadonlyMap<number, bigint>;
  ledger: RpcLedger;
};

type ProjectionScanInput = {
  client: ProjectionReadClient;
  lending: Address;
  fromBlock: bigint;
  snapshot?: HeadSnapshot;
  previousCheckpoint?: BlockIdentity;
  signal?: AbortSignal;
};

type MarketProjectionInput = ProjectionScanInput & {
  market: Address;
};

function metadata(block: BlockIdentity) {
  return { blockNumber: block.number, blockHash: block.hash };
}

function failureOutcome<T>(
  source: string,
  error: unknown,
  block?: BlockIdentity,
): ReadOutcome<T> {
  const cancelled =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";
  return unavailableOutcome(
    [
      readFailure(source, cancelled ? "cancelled" : "transport", error, {
        retryable: true,
      }),
    ],
    block ? metadata(block) : {},
  );
}

async function requireSnapshot(
  client: ProjectionReadClient,
  snapshot?: HeadSnapshot,
): Promise<HeadSnapshot> {
  if (!snapshot) return captureHeadSnapshot(client);
  const block = await client.getBlock({ blockNumber: snapshot.latest.number });
  if (block.hash?.toLowerCase() !== snapshot.latest.hash.toLowerCase()) {
    throw new Error("Projection provider disagrees with the pinned latest block");
  }
  return snapshot;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Discovery cancelled", "AbortError");
  }
}

export type ClaimAllRegistryProjection = {
  entries: readonly {
    vault: Address;
    lending: Address | null;
  }[];
  vaults: readonly Address[];
  lendings: readonly Address[];
};

export async function discoverClaimAllRegistry({
  client,
  factory,
  snapshot,
  signal,
}: {
  client: ProjectionReadClient;
  factory: Address;
  snapshot: HeadSnapshot;
  signal?: AbortSignal;
}): Promise<ReadOutcome<ClaimAllRegistryProjection>> {
  let pinned: HeadSnapshot | undefined;
  try {
    pinned = await requireSnapshot(client, snapshot);
    throwIfAborted(signal);
    const rawCount = await client.readContract({
      address: factory,
      abi: ovrfloFactoryAbi,
      functionName: "ovrfloCount",
      blockNumber: pinned.latest.number,
    });
    if (typeof rawCount !== "bigint" || rawCount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Factory vault count is invalid");
    }
    const expectedCount = Number(rawCount);
    if (expectedCount > MAX_VAULT_REGISTRY_ENTRIES) {
      const overflow = adaptVaultRegistryChunks({
        expectedCount,
        maxExpectedCount: MAX_VAULT_REGISTRY_ENTRIES,
        chunkSize: PROJECTION_HYDRATION_CHUNK_SIZE,
        chunks: [],
        metadata: metadata(pinned.latest),
      });
      return unavailableOutcome(overflow.failures, overflow.metadata);
    }
    const registryChunks = [];
    for (
      let start = 0;
      start < expectedCount;
      start += PROJECTION_HYDRATION_CHUNK_SIZE
    ) {
      throwIfAborted(signal);
      const indexes = Array.from(
        {
          length: Math.min(
            PROJECTION_HYDRATION_CHUNK_SIZE,
            expectedCount - start,
          ),
        },
        (_, offset) => start + offset,
      );
      const results = await Promise.all(
        indexes.map(async (index): Promise<ShadowBatchResult<Address>> => {
          try {
            const vault = await client.readContract({
              address: factory,
              abi: ovrfloFactoryAbi,
              functionName: "ovrflos",
              args: [BigInt(index)],
              blockNumber: pinned!.latest.number,
            });
            if (
              typeof vault !== "string" ||
              !vault.startsWith("0x") ||
              isAddressEqual(vault as Address, ZERO_ADDRESS)
            ) {
              throw new Error(`Factory vault ${index} is invalid`);
            }
            return { status: "success", value: vault as Address };
          } catch (error) {
            return { status: "failure", error, entityId: index };
          }
        }),
      );
      registryChunks.push({ start, results });
    }
    throwIfAborted(signal);
    const registry = adaptVaultRegistryChunks({
      expectedCount,
      maxExpectedCount: MAX_VAULT_REGISTRY_ENTRIES,
      chunkSize: PROJECTION_HYDRATION_CHUNK_SIZE,
      chunks: registryChunks,
      metadata: metadata(pinned.latest),
    });
    if (registry.status !== "ready") {
      return unavailableOutcome(registry.failures, registry.metadata);
    }
    const uniqueVaults = new Map(
      registry.data.map((vault) => [vault.toLowerCase(), vault]),
    );
    if (uniqueVaults.size !== registry.data.length) {
      return unavailableOutcome(
        [
          readFailure(
            "claim-all-registry",
            "invalid",
            "Factory vault registry contains duplicate addresses",
            { retryable: false },
          ),
        ],
        metadata(pinned.latest),
      );
    }

    const lendingResults: ShadowBatchResult<Address>[] = [];
    for (
      let start = 0;
      start < registry.data.length;
      start += PROJECTION_HYDRATION_CHUNK_SIZE
    ) {
      throwIfAborted(signal);
      lendingResults.push(
        ...(await Promise.all(
          registry.data
            .slice(start, start + PROJECTION_HYDRATION_CHUNK_SIZE)
            .map(async (vault): Promise<ShadowBatchResult<Address>> => {
              try {
                const lending = await client.readContract({
                  address: factory,
                  abi: ovrfloFactoryAbi,
                  functionName: "ovrfloToLending",
                  args: [vault],
                  blockNumber: pinned!.latest.number,
                });
                if (
                  typeof lending !== "string" ||
                  !lending.startsWith("0x")
                ) {
                  throw new Error(`Lending address for ${vault} is invalid`);
                }
                return isAddressEqual(lending as Address, ZERO_ADDRESS)
                  ? { status: "excluded", reason: "vault has no lending market" }
                  : { status: "success", value: lending as Address };
              } catch (error) {
                return { status: "failure", error, entityId: vault };
              }
            }),
        )),
      );
    }
    throwIfAborted(signal);
    const lendings = adaptBatch({
      source: "claim-all-registry",
      results: lendingResults,
      metadata: metadata(pinned.latest),
    });
    if (lendings.status !== "ready") {
      return unavailableOutcome(lendings.failures, lendings.metadata);
    }
    const entries = registry.data.map((vault, index) => {
      const lending = lendingResults[index];
      return {
        vault,
        lending: lending?.status === "success" ? lending.value : null,
      };
    });
    return readyOutcome(
      {
        entries,
        vaults: [...uniqueVaults.values()],
        lendings: lendings.data,
      },
      metadata(pinned.latest),
    );
  } catch (error) {
    return failureOutcome("claim-all-registry", error, pinned?.latest);
  }
}

function sortedIds(projection: LendingProjection): bigint[] {
  return [...projection.positions.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

async function hydratePositions(
  client: ProjectionReadClient,
  lending: Address,
  projection: LendingProjection,
  signal?: AbortSignal,
): Promise<ReadOutcome<readonly LiquidityPosition[]>> {
  const candidateIds = sortedIds(projection);
  if (candidateIds.length > MAX_PROJECTED_CANDIDATES) {
    return unavailableOutcome(
      [
        readFailure(
          "liquidity-hydration",
          "fragmented",
          `Liquidity candidate count ${candidateIds.length} exceeds the ${MAX_PROJECTED_CANDIDATES} direct-hydration budget`,
          { retryable: false },
        ),
      ],
      metadata(projection.completeThrough),
    );
  }
  const plan = planBlockPinnedHydration({
    candidateIds,
    blockNumber: projection.completeThrough.number,
    maxCandidates: MAX_PROJECTED_CANDIDATES,
    chunkSize: PROJECTION_HYDRATION_CHUNK_SIZE,
  });
  const chunks = [];
  for (const ids of plan.chunks) {
    throwIfAborted(signal);
    const results = await Promise.all(
      ids.map(async (id): Promise<ShadowBatchResult<LiquidityPosition>> => {
        try {
          const [lender, market, aprBps, availableLiquidity] =
            (await client.readContract({
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "liquidityPositions",
              args: [id],
              blockNumber: plan.blockNumber,
            })) as [Address, Address, number, bigint];
          return {
            status: "success",
            value: { id, lender, market, aprBps, availableLiquidity },
          };
        } catch (error) {
          return { status: "failure", error, entityId: id };
        }
      }),
    );
    chunks.push({ blockNumber: plan.blockNumber, results });
  }
  throwIfAborted(signal);
  const hydrated = adaptBlockPinnedHydration({
    source: "liquidity-hydration",
    plan,
    chunks,
    metadata: metadata(projection.completeThrough),
  });
  if (hydrated.status !== "ready") {
    return unavailableOutcome(hydrated.failures, hydrated.metadata);
  }

  const failures = [];
  const positionsById = new Map(
    hydrated.data.values.map((position) => [position.id, position]),
  );
  for (const [id, projected] of projection.positions) {
    const direct = positionsById.get(id);
    if (
      !direct ||
      !isAddressEqual(direct.lender, projected.lender) ||
      !isAddressEqual(direct.market, projected.market) ||
      direct.aprBps !== projected.aprBps ||
      direct.availableLiquidity !== projected.availableLiquidity
    ) {
      failures.push(
        readFailure(
          "liquidity-hydration",
          "invalid",
          `Projected liquidity ${id} disagrees with direct hydration`,
          { retryable: false, entityId: id },
        ),
      );
    }
  }
  if (failures.length > 0) {
    return unavailableOutcome(failures, metadata(projection.completeThrough));
  }
  return readyOutcome(
    hydrated.data.values,
    metadata(projection.completeThrough),
  );
}

async function scanCheckpoints({
  client,
  lending,
  fromBlock,
  snapshot,
  previousCheckpoint,
  signal,
  market,
  lender,
}: ProjectionScanInput & { market?: Address; lender?: Address }) {
  const pinned = await requireSnapshot(client, snapshot);
  const scan = await scanLogs(client, {
    address: lending,
    topics: liquidityCheckpointTopics({ market, lender }),
    fromBlock,
    snapshot: pinned,
    rangeSize: DISCOVERY_RANGE_SIZE,
    decode: decodeLiquidityCheckpoint,
    previousCheckpoint,
    signal,
  });
  if (scan.status !== "complete") return scan;
  return {
    ...scan,
    projection: projectLending(
      [],
      scan.logs.map((log) => log.decoded),
      scan.completeThrough,
    ),
  };
}

export async function discoverMarketLiquidity(
  input: MarketProjectionInput,
): Promise<ReadOutcome<MarketLiquidityProjection>> {
  let scanned;
  try {
    scanned = await scanCheckpoints({ ...input, market: input.market });
  } catch (error) {
    return failureOutcome("market-projection", error);
  }
  if (scanned.status !== "complete") {
    return failureOutcome(
      "market-projection",
      scanned.status === "failed"
        ? scanned.failure.message
        : "Market projection was cancelled",
    );
  }

  const { projection } = scanned;
  let hydrated: ReadOutcome<readonly LiquidityPosition[]>;
  try {
    hydrated = await hydratePositions(
      input.client,
      input.lending,
      projection,
      input.signal,
    );
  } catch (error) {
    return failureOutcome(
      "market-projection",
      error,
      projection.completeThrough,
    );
  }
  if (hydrated.status !== "ready") {
    return unavailableOutcome(hydrated.failures, hydrated.metadata);
  }

  try {
    const blockNumber = projection.completeThrough.number;
    const aggregateDepth = (await input.client.readContract({
      address: input.lending,
      abi: ovrfloLendingAbi,
      functionName: "marketAvailableLiquidity",
      args: [input.market],
      blockNumber,
    })) as bigint;
    const aprs = [
      ...new Set(
        [...projection.positions.values()]
          .filter((position) => isAddressEqual(position.market, input.market))
          .map((position) => position.aprBps),
      ),
    ].sort((left, right) => left - right);
    const aggregateByApr = new Map<number, bigint>();
    for (
      let offset = 0;
      offset < aprs.length;
      offset += PROJECTION_HYDRATION_CHUNK_SIZE
    ) {
      throwIfAborted(input.signal);
      const chunk = aprs.slice(
        offset,
        offset + PROJECTION_HYDRATION_CHUNK_SIZE,
      );
      const aggregates = await Promise.all(
        chunk.map(
          (aprBps) =>
            input.client.readContract({
              address: input.lending,
              abi: ovrfloLendingAbi,
              functionName: "marketAprAvailableLiquidity",
              args: [input.market, aprBps],
              blockNumber,
            }) as Promise<bigint>,
        ),
      );
      for (const [index, aprBps] of chunk.entries()) {
        const aggregate = aggregates[index];
        const conservation = conserveMarketApr(
          projection,
          input.market,
          aprBps,
          aggregate,
          projection.completeThrough,
        );
        if (conservation.status !== "conserved") {
          return unavailableOutcome(
            [
              readFailure(
                "market-projection",
                "invalid",
                `Projected APR ${aprBps} depth disagrees with the contract aggregate`,
                {
                  retryable: false,
                  entityId: marketAprKey(input.market, aprBps),
                },
              ),
            ],
            metadata(projection.completeThrough),
          );
        }
        aggregateByApr.set(aprBps, aggregate);
      }
    }
    const projectedDepth = [...projection.positions.values()]
      .filter((position) => isAddressEqual(position.market, input.market))
      .reduce((sum, position) => sum + position.availableLiquidity, 0n);
    if (projectedDepth !== aggregateDepth) {
      return unavailableOutcome(
        [
          readFailure(
            "market-projection",
            "invalid",
            "Projected market depth disagrees with the contract aggregate",
            { retryable: false },
          ),
        ],
        metadata(projection.completeThrough),
      );
    }
    return readyOutcome(
      {
        projection,
        positions: hydrated.data,
        aggregateDepth,
        aggregateByApr,
        ledger: scanned.ledger,
      },
      metadata(projection.completeThrough),
    );
  } catch (error) {
    return failureOutcome(
      "market-projection",
      error,
      projection.completeThrough,
    );
  }
}

type AccountCandidateProjection = {
  liquidityPositions: readonly LiquidityPosition[];
  lenderLoanIds: readonly bigint[];
  borrowerLoans: readonly BorrowerLoanCandidate[];
  ledger: RpcLedger;
};

export async function discoverAccountCandidates({
  client,
  lending,
  account,
  fromBlock,
  snapshot,
  previousCheckpoint,
  signal,
  hydrateLiquidityPositions = true,
}: ProjectionScanInput & {
  account: Address;
  hydrateLiquidityPositions?: boolean;
}): Promise<
  ReadOutcome<AccountCandidateProjection>
> {
  let pinned: HeadSnapshot | undefined;
  try {
    pinned = await requireSnapshot(client, snapshot);
  } catch (error) {
    return failureOutcome("account-projection", error);
  }
  const [lenderScan, borrowerScan] = await Promise.all([
    scanCheckpoints({
      client,
      lending,
      fromBlock,
      snapshot: pinned,
      previousCheckpoint,
      signal,
      lender: account,
    }),
    scanLogs(client, {
      address: lending,
      topics: borrowerLoanTopics({ borrower: account }),
      fromBlock,
      snapshot: pinned,
      rangeSize: DISCOVERY_RANGE_SIZE,
      decode: decodeBorrowerLoanCandidate,
      previousCheckpoint,
      signal,
    }),
  ]);
  if (lenderScan.status !== "complete" || borrowerScan.status !== "complete") {
    const message =
      lenderScan.status === "failed"
        ? lenderScan.failure.message
        : borrowerScan.status === "failed"
          ? borrowerScan.failure.message
          : "Account projection was cancelled";
    return failureOutcome("account-projection", message);
  }
  let liquidityPositions: readonly LiquidityPosition[] = [];
  if (hydrateLiquidityPositions) {
    const hydrated = await hydratePositions(
      client,
      lending,
      lenderScan.projection,
      signal,
    );
    if (hydrated.status !== "ready") {
      return unavailableOutcome(hydrated.failures, hydrated.metadata);
    }
    liquidityPositions = hydrated.data;
  }
  return readyOutcome(
    {
      liquidityPositions,
      lenderLoanIds:
        lenderScan.projection.loanIdsByLender.get(account.toLowerCase()) ?? [],
      borrowerLoans: projectBorrowerLoans(
        borrowerScan.logs.map((log) => log.decoded),
      ),
      ledger: mergeLedgers(lenderScan.ledger, borrowerScan.ledger),
    },
    metadata(lenderScan.completeThrough),
  );
}

function mergeLedgers(left: RpcLedger, right: RpcLedger): RpcLedger {
  return {
    attempts: [...left.attempts, ...right.attempts],
    requestBytes: left.requestBytes + right.requestBytes,
    responseBytes: left.responseBytes + right.responseBytes,
    reducerDurationMs: left.reducerDurationMs + right.reducerDurationMs,
    durationMs: Math.max(left.durationMs, right.durationMs),
    providerCostEstimate:
      left.providerCostEstimate + right.providerCostEstimate,
  };
}

export function projectionCandidateIds(
  outcome: ReadOutcome<AccountCandidateProjection>,
): readonly bigint[] {
  if (outcome.status !== "ready") return [];
  return [
    ...new Set([
      ...outcome.data.lenderLoanIds,
      ...outcome.data.borrowerLoans.map((loan) => loan.loanId),
    ]),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export type AccountLoanPoolRow = {
  pool: LoanPool;
  loan: Loan;
  contribution: bigint;
  received: bigint;
  withdrawable: bigint;
  claimable: bigint;
};

export type AccountBorrowerLoanRow = {
  pool: LoanPool;
  loan: Loan;
  withdrawable: bigint;
};

export type AccountLoanBookProjection = AccountCandidateProjection & {
  pools: readonly AccountLoanPoolRow[];
  loans: readonly AccountBorrowerLoanRow[];
};

export async function discoverAccountLoanBook(
  input: ProjectionScanInput & { account: Address },
): Promise<ReadOutcome<AccountLoanBookProjection>> {
  const candidates = await discoverAccountCandidates({
    ...input,
    hydrateLiquidityPositions: false,
  });
  if (candidates.status !== "ready") {
    return unavailableOutcome(candidates.failures, candidates.metadata);
  }
  const ids = projectionCandidateIds(candidates);
  if (ids.length > MAX_PROJECTED_CANDIDATES) {
    return unavailableOutcome(
      [
        readFailure(
          "account-hydration",
          "fragmented",
          `Account candidate count ${ids.length} exceeds the ${MAX_PROJECTED_CANDIDATES} direct-hydration budget`,
          { retryable: false },
        ),
      ],
      candidates.metadata,
    );
  }

  type HydratedLoanRow = {
    pool: LoanPool;
    loan: Loan;
    contribution: bigint;
    received: bigint;
    withdrawable: bigint;
  };
  const plan = planBlockPinnedHydration({
    candidateIds: ids,
    blockNumber: candidates.metadata.blockNumber!,
    maxCandidates: MAX_PROJECTED_CANDIDATES,
    chunkSize: PROJECTION_HYDRATION_CHUNK_SIZE,
  });
  const chunks = [];
  for (const chunk of plan.chunks) {
    throwIfAborted(input.signal);
    const hydrated = await Promise.all(
      chunk.map(async (id): Promise<ShadowBatchResult<HydratedLoanRow>> => {
        try {
          const [poolTuple, loanTuple, contribution, received] =
            await Promise.all([
              input.client.readContract({
                address: input.lending,
                abi: ovrfloLendingAbi,
                functionName: "loanPools",
                args: [id],
                blockNumber: plan.blockNumber,
              }) as Promise<[Address, number, Address, bigint]>,
              input.client.readContract({
                address: input.lending,
                abi: ovrfloLendingAbi,
                functionName: "loans",
                args: [id],
                blockNumber: plan.blockNumber,
              }) as Promise<
                [Address, bigint, bigint, bigint, bigint, boolean]
              >,
              input.client.readContract({
                address: input.lending,
                abi: ovrfloLendingAbi,
                functionName: "loanPoolContributions",
                args: [id, input.account],
                blockNumber: plan.blockNumber,
              }) as Promise<bigint>,
              input.client.readContract({
                address: input.lending,
                abi: ovrfloLendingAbi,
                functionName: "loanPoolReceived",
                args: [id, input.account],
                blockNumber: plan.blockNumber,
              }) as Promise<bigint>,
            ]);
          if (
            isAddressEqual(poolTuple[0], ZERO_ADDRESS) ||
            isAddressEqual(loanTuple[0], ZERO_ADDRESS)
          ) {
            throw new Error(`Projected loan ${id} does not exist`);
          }
          const loan: Loan = {
            id,
            borrower: loanTuple[0],
            streamId: loanTuple[1],
            obligation: loanTuple[2],
            drawn: loanTuple[3],
            repaid: loanTuple[4],
            closed: loanTuple[5],
          };
          const pool: LoanPool = {
            id,
            borrower: poolTuple[0],
            aprBps: poolTuple[1],
            market: poolTuple[2],
            totalContributed: poolTuple[3],
          };
          const withdrawable = (await input.client.readContract({
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "withdrawableAmountOf",
            args: [loan.streamId],
            blockNumber: plan.blockNumber,
          })) as bigint;
          return {
            status: "success" as const,
            value: { pool, loan, contribution, received, withdrawable },
          };
        } catch (error) {
          return { status: "failure", entityId: id, error };
        }
      }),
    );
    chunks.push({ blockNumber: plan.blockNumber, results: hydrated });
  }
  throwIfAborted(input.signal);
  const hydratedRows = adaptBlockPinnedHydration({
    source: "account-hydration",
    plan,
    chunks,
    metadata: candidates.metadata,
  });
  if (hydratedRows.status !== "ready") {
    return unavailableOutcome(hydratedRows.failures, hydratedRows.metadata);
  }
  const rows = hydratedRows.data.values;

  const pools = rows
    .filter((row) => row.contribution > 0n)
    .map((row) => ({
      ...row,
      claimable: loanPoolClaimable({
        contribution: row.contribution,
        received: row.received,
        recovered: recoveredForClaimable({
          loan: row.loan,
          withdrawable: row.withdrawable,
        }),
        totalContributed: row.pool.totalContributed,
      }),
    }))
    .sort((left, right) =>
      left.pool.id > right.pool.id
        ? -1
        : left.pool.id < right.pool.id
          ? 1
          : 0,
    );
  const loans = rows
    .filter((row) => isAddressEqual(row.loan.borrower, input.account))
    .map(({ pool, loan, withdrawable }) => ({ pool, loan, withdrawable }))
    .sort((left, right) =>
      left.loan.id > right.loan.id
        ? -1
        : left.loan.id < right.loan.id
          ? 1
          : 0,
    );
  return readyOutcome(
    { ...candidates.data, pools, loans },
    candidates.metadata,
  );
}

type SablierStream = {
  sender: Address;
  asset: Address;
  endTime: bigint | number;
  wasCanceled: boolean;
  isDepleted: boolean;
  isStream: boolean;
  amounts: { deposited: bigint; withdrawn: bigint };
};

export type HeldStreamProjection = {
  streams: readonly HeldStream[];
  candidateIds: readonly bigint[];
  ledger: RpcLedger;
};

export async function discoverHeldStreams({
  client,
  vaults,
  account,
  fromBlock,
  snapshot,
  previousCheckpoint,
  signal,
}: {
  client: ProjectionReadClient;
  vaults: readonly Address[];
  account: Address;
  fromBlock: bigint;
  snapshot?: HeadSnapshot;
  previousCheckpoint?: BlockIdentity;
  signal?: AbortSignal;
}): Promise<ReadOutcome<HeldStreamProjection>> {
  let pinned: HeadSnapshot | undefined;
  try {
    pinned = await requireSnapshot(client, snapshot);
  } catch (error) {
    return failureOutcome("stream-projection", error);
  }
  if (vaults.length === 0) {
    return readyOutcome(
      {
        streams: [],
        candidateIds: [],
        ledger: emptyLedger(),
      },
      metadata(pinned.latest),
    );
  }
  const [origins, transfers] = await Promise.all([
    scanLogs(client, {
      address: vaults,
      topics: depositedTopics(),
      fromBlock,
      snapshot: pinned,
      rangeSize: DISCOVERY_RANGE_SIZE,
      decode: decodeDepositedOrigin,
      previousCheckpoint,
      signal,
    }),
    scanLogs(client, {
      address: SABLIER_LOCKUP_ADDRESS,
      topics: recipientTransferTopics(account),
      fromBlock,
      snapshot: pinned,
      rangeSize: DISCOVERY_RANGE_SIZE,
      decode: decodeRecipientTransfer,
      previousCheckpoint,
      signal,
    }),
  ]);
  if (origins.status !== "complete" || transfers.status !== "complete") {
    const message =
      origins.status === "failed"
        ? origins.failure.message
        : transfers.status === "failed"
          ? transfers.failure.message
          : "Stream projection was cancelled";
    return failureOutcome("stream-projection", message);
  }
  const discovery = discoverStreamCandidates({
    vaultRegistry: { status: "complete", vaults },
    origins: origins.logs.map((log) => log.decoded),
    recipientTransfers: transfers.logs.map((log) => log.decoded),
    recipient: account,
    candidateLimit: MAX_PROJECTED_CANDIDATES,
  });
  if (discovery.status !== "complete") {
    return unavailableOutcome(
      [
        readFailure("stream-projection", "fragmented", discovery.error, {
          retryable: false,
        }),
      ],
      metadata(pinned.latest),
    );
  }

  const plan = planBlockPinnedHydration({
    candidateIds: discovery.candidateIds,
    blockNumber: pinned.latest.number,
    maxCandidates: MAX_PROJECTED_CANDIDATES,
    chunkSize: PROJECTION_HYDRATION_CHUNK_SIZE,
  });
  const results: ShadowBatchResult<HeldStream>[] = [];
  for (const ids of plan.chunks) {
    throwIfAborted(signal);
    const hydrated = await Promise.all(
      ids.map(async (streamId): Promise<ShadowBatchResult<HeldStream>> => {
        try {
          const [record, withdrawable, owner] = await Promise.all([
            client.readContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "getStream",
              args: [streamId],
              blockNumber: pinned.latest.number,
            }) as Promise<SablierStream>,
            client.readContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "withdrawableAmountOf",
              args: [streamId],
              blockNumber: pinned.latest.number,
            }) as Promise<bigint>,
            client.readContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "ownerOf",
              args: [streamId],
              blockNumber: pinned.latest.number,
            }) as Promise<Address>,
          ]);
          if (!record.isStream || !isAddressEqual(owner, account)) {
            return {
              status: "excluded",
              reason: "stream is absent or no longer owned by the account",
            };
          }
          return {
            status: "success" as const,
            value: {
              streamId,
              recipient: owner,
              sender: record.sender,
              asset: record.asset,
              endTime: BigInt(record.endTime),
              canceled: record.wasCanceled,
              depleted: record.isDepleted,
              deposited: record.amounts.deposited,
              withdrawn: record.amounts.withdrawn,
              withdrawable,
            } satisfies HeldStream,
          };
        } catch (error) {
          return { status: "failure", entityId: streamId, error };
        }
      }),
    );
    results.push(...hydrated);
  }
  throwIfAborted(signal);
  const hydratedStreams = adaptBatch({
    source: "stream-hydration",
    results,
    metadata: metadata(pinned.latest),
  });
  if (hydratedStreams.status !== "ready") {
    return unavailableOutcome(
      hydratedStreams.failures,
      hydratedStreams.metadata,
    );
  }
  return readyOutcome(
    {
      streams: [...hydratedStreams.data].sort((left, right) =>
        left.streamId < right.streamId
          ? -1
          : left.streamId > right.streamId
            ? 1
            : 0,
      ),
      candidateIds: discovery.candidateIds,
      ledger: mergeLedgers(origins.ledger, transfers.ledger),
    },
    metadata(pinned.latest),
  );
}

export type BorrowDemandProjection = {
  events: readonly BorrowDemandEvent[];
  ledger: RpcLedger;
};

export async function discoverBorrowDemand({
  client,
  lending,
  market,
  fromBlock,
  snapshot,
  previousCheckpoint,
  signal,
}: MarketProjectionInput): Promise<ReadOutcome<BorrowDemandProjection>> {
  let pinned: HeadSnapshot | undefined;
  try {
    pinned = await requireSnapshot(client, snapshot);
    const headBlock = await client.getBlock({
      blockNumber: pinned.latest.number,
    });
    if (headBlock.timestamp === undefined) {
      throw new Error("Demand head block has no timestamp");
    }
    const cutoffBlock = await findDemandCutoffBlock({
      fromBlock,
      head: {
        number: pinned.latest.number,
        timestamp: headBlock.timestamp,
      },
      getBlock: async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        if (block.number === null || block.timestamp === undefined) {
          throw new Error(`Demand block ${blockNumber} is incomplete`);
        }
        return { number: block.number, timestamp: block.timestamp };
      },
    });
    const scan = await scanLogs(client, {
      address: lending,
      topics: borrowerLoanTopics({ market }),
      fromBlock: cutoffBlock,
      snapshot: pinned,
      rangeSize: DISCOVERY_RANGE_SIZE,
      decode: decodeBorrowerLoanCandidate,
      previousCheckpoint,
      signal,
    });
    if (scan.status !== "complete") {
      return failureOutcome(
        "demand-projection",
        scan.status === "failed"
          ? scan.failure.message
          : "Demand projection was cancelled",
      );
    }
    const blockNumbers = [
      ...new Set(scan.logs.map((log) => log.blockNumber)),
    ];
    const timestamps = new Map<bigint, bigint>();
    for (
      let offset = 0;
      offset < blockNumbers.length;
      offset += PROJECTION_HYDRATION_CHUNK_SIZE
    ) {
      throwIfAborted(signal);
      const chunk = blockNumbers.slice(
        offset,
        offset + PROJECTION_HYDRATION_CHUNK_SIZE,
      );
      const blocks = await Promise.all(
        chunk.map((blockNumber) => client.getBlock({ blockNumber })),
      );
      blocks.forEach((block, index) => {
        if (block.timestamp === undefined) {
          throw new Error(`Demand block ${chunk[index]} has no timestamp`);
        }
        timestamps.set(chunk[index], block.timestamp);
      });
    }
    return readyOutcome(
      {
        events: scan.logs.map((log) => ({
          aprBps: log.decoded.aprBps,
          amount: log.decoded.totalContributed,
          borrower: log.decoded.borrower,
          blockTimestamp: timestamps.get(log.blockNumber)!,
        })),
        ledger: scan.ledger,
      },
      metadata(scan.completeThrough),
    );
  } catch (error) {
    return failureOutcome("demand-projection", error, pinned?.latest);
  }
}

export type ClaimAllDiscoveryProjection = {
  poolCandidateIds: readonly ClaimAllCandidateId[];
  streamCandidateIds: readonly ClaimAllCandidateId[];
  candidateIds: readonly ClaimAllCandidateId[];
  ledger: RpcLedger;
};

export async function discoverClaimAllCandidates({
  client,
  lendings,
  vaults,
  account,
  fromBlock,
  snapshot,
  signal,
}: {
  client: ProjectionReadClient;
  lendings: readonly Address[];
  vaults: readonly Address[];
  account: Address;
  fromBlock: bigint;
  snapshot?: HeadSnapshot;
  signal?: AbortSignal;
}): Promise<ReadOutcome<ClaimAllDiscoveryProjection>> {
  let pinned: HeadSnapshot;
  try {
    pinned = await requireSnapshot(client, snapshot);
  } catch (error) {
    return failureOutcome("claim-all-discovery", error);
  }
  const uniqueLendings = [
    ...new Map(
      lendings.map((lending) => [lending.toLowerCase(), lending]),
    ).values(),
  ];
  const booksPromise = (async () => {
    const outcomes: ReadOutcome<AccountLoanBookProjection>[] = [];
    for (let offset = 0; offset < uniqueLendings.length; offset += 2) {
      throwIfAborted(signal);
      outcomes.push(
        ...(await Promise.all(
          uniqueLendings.slice(offset, offset + 2).map((lending) =>
            discoverAccountLoanBook({
              client,
              lending,
              account,
              fromBlock,
              snapshot: pinned,
              signal,
            }),
          ),
        )),
      );
    }
    return outcomes;
  })();
  const [books, streams] = await Promise.all([
    booksPromise,
    discoverHeldStreams({
      client,
      vaults,
      account,
      fromBlock,
      snapshot: pinned,
      signal,
    }),
  ]);
  const failed = [...books, streams].find(
    (outcome) => outcome.status !== "ready",
  );
  if (failed) {
    return unavailableOutcome(failed.failures, metadata(pinned.latest));
  }
  const readyBooks = books as Array<
    Extract<(typeof books)[number], { status: "ready" }>
  >;
  const readyStreams = streams as Extract<
    typeof streams,
    { status: "ready" }
  >;
  const accountCandidateCount = readyBooks.reduce(
    (total, book) => total + projectionCandidateIds(book).length,
    0,
  );
  if (
    accountCandidateCount + readyStreams.data.candidateIds.length >
    MAX_PROJECTED_CANDIDATES
  ) {
    return unavailableOutcome(
      [
        readFailure(
          "claim-all-discovery",
          "fragmented",
          `Claim All candidate count exceeds the ${MAX_PROJECTED_CANDIDATES} direct-hydration budget`,
          { retryable: false },
        ),
      ],
      metadata(pinned.latest),
    );
  }
  const poolCandidateIds = readyBooks.flatMap((book, index) =>
    book.data.pools
      .filter((pool) => pool.claimable > 0n)
      .map((pool) =>
        claimAllPoolCandidate(uniqueLendings[index], pool.pool.id),
      ),
  );
  const streamCandidateIds = readyStreams.data.streams
    .filter((stream) => stream.withdrawable > 0n)
    .map((stream) => claimAllStreamCandidate(stream.streamId));
  const candidateIds = [
    ...new Set([...poolCandidateIds, ...streamCandidateIds]),
  ].sort();
  const ledger = [
    ...readyBooks.map((book) => book.data.ledger),
    readyStreams.data.ledger,
  ].reduce(mergeLedgers, emptyLedger());
  return readyOutcome(
    { poolCandidateIds, streamCandidateIds, candidateIds, ledger },
    metadata(pinned.latest),
  );
}

function emptyLedger(): RpcLedger {
  return {
    attempts: [],
    requestBytes: 0,
    responseBytes: 0,
    reducerDurationMs: 0,
    durationMs: 0,
    providerCostEstimate: 0,
  };
}
