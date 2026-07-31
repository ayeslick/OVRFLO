import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  loadClaimAllPreflight,
  useClaimAllPreflight,
} from "@/hooks/useClaimAllPreflight";
import type {
  ClaimAllDiscoveryProjection,
  ClaimAllRegistryProjection,
  ProjectionReadClient,
} from "@/lib/discovery/live-projection";
import type { ClaimAllPreflightEvaluation } from "@/lib/claim-all";
import type { HeadSnapshot, RpcLedger } from "@/lib/discovery/log-scanner";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
} from "@/lib/read-outcome";

const mocks = vi.hoisted(() => ({
  captureHeadSnapshot: vi.fn(),
  discoverClaimAllRegistry: vi.fn(),
  discoverClaimAllCandidates: vi.fn(),
  projectionSync: vi.fn(),
  getProjectionClient: vi.fn(),
}));

vi.mock("@/lib/discovery/log-scanner", () => ({
  captureHeadSnapshot: mocks.captureHeadSnapshot,
}));
vi.mock("@/lib/discovery/live-projection", () => ({
  discoverClaimAllRegistry: mocks.discoverClaimAllRegistry,
  discoverClaimAllCandidates: mocks.discoverClaimAllCandidates,
}));
vi.mock("@/hooks/useProjectionSync", () => ({
  getProjectionClient: mocks.getProjectionClient,
  useProjectionSync: mocks.projectionSync,
}));

const account = address(0xa11);
const primaryVault = address(0x101);
const verifierVault = address(0x102);
const lending = address(0x201);
const lendingB = address(0x202);
const primaryClient = { provider: "primary" } as unknown as ProjectionReadClient;
const verifierClient = {
  provider: "verifier",
} as unknown as ProjectionReadClient;
const snapshot: HeadSnapshot = {
  finalized: { number: 99n, hash: hash(99) },
  latest: { number: 100n, hash: hash(100) },
};
const metadata = {
  blockNumber: snapshot.latest.number,
  blockHash: snapshot.latest.hash,
};
const ledger: RpcLedger = {
  attempts: [],
  requestBytes: 0,
  responseBytes: 0,
  reducerDurationMs: 0,
  durationMs: 0,
  providerCostEstimate: 0,
};

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function hash(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function registry(
  vaults: readonly Address[],
  lendings: readonly Address[] = [lending],
) {
  return readyOutcome<ClaimAllRegistryProjection>(
    {
      entries: vaults.map((vault, index) => ({
        vault,
        lending: lendings[index] ?? lendings[0] ?? null,
      })),
      vaults,
      lendings,
    },
    metadata,
  );
}

function discovery(
  poolCandidateIds: ClaimAllDiscoveryProjection["poolCandidateIds"],
  streamCandidateIds: ClaimAllDiscoveryProjection["streamCandidateIds"] = [],
) {
  return readyOutcome<ClaimAllDiscoveryProjection>(
    {
      poolCandidateIds,
      streamCandidateIds,
      candidateIds: [...poolCandidateIds, ...streamCandidateIds].sort(),
      ledger,
    },
    metadata,
  );
}

describe("loadClaimAllPreflight", () => {
  beforeEach(() => {
    mocks.captureHeadSnapshot.mockReset().mockResolvedValue(snapshot);
    mocks.discoverClaimAllRegistry.mockReset();
    mocks.discoverClaimAllCandidates.mockReset();
    mocks.projectionSync.mockReset();
    mocks.getProjectionClient.mockReset();
  });

  it("independently discovers both registries at one snapshot before comparing candidates", async () => {
    mocks.discoverClaimAllRegistry.mockImplementation(
      async () => registry([primaryVault]),
    );
    const primaryCandidates = discovery([
      `pool:${lending.toLowerCase()}:7`,
    ]);
    mocks.discoverClaimAllCandidates.mockResolvedValue(primaryCandidates);

    const outcome = await loadClaimAllPreflight({
      primaryClient,
      verifierClient,
      account,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data).toMatchObject({
      status: "ready",
      canReview: true,
      reason: null,
      candidateIds: [`pool:${lending.toLowerCase()}:7`],
    });
    expect(mocks.discoverClaimAllRegistry).toHaveBeenCalledTimes(2);
    expect(mocks.discoverClaimAllRegistry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ client: primaryClient, snapshot }),
    );
    expect(mocks.discoverClaimAllRegistry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ client: verifierClient, snapshot }),
    );
    expect(mocks.discoverClaimAllCandidates).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        client: primaryClient,
        vaults: [primaryVault],
        lendings: [lending],
        snapshot,
      }),
    );
    expect(mocks.discoverClaimAllCandidates).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        client: verifierClient,
        vaults: [primaryVault],
        lendings: [lending],
        snapshot,
      }),
    );
  });

  it("blocks before candidate scanning when provider registries disagree", async () => {
    mocks.discoverClaimAllRegistry
      .mockResolvedValueOnce(registry([primaryVault]))
      .mockResolvedValueOnce(registry([verifierVault]));

    const outcome = await loadClaimAllPreflight({
      primaryClient,
      verifierClient,
      account,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "provider-disagreement",
    });
    expect(mocks.discoverClaimAllCandidates).not.toHaveBeenCalled();
  });

  it("blocks when providers return the same sets with different vault associations", async () => {
    mocks.discoverClaimAllRegistry
      .mockResolvedValueOnce(
        registry([primaryVault, verifierVault], [lending, lendingB]),
      )
      .mockResolvedValueOnce(
        registry([primaryVault, verifierVault], [lendingB, lending]),
      );

    const outcome = await loadClaimAllPreflight({
      primaryClient,
      verifierClient,
      account,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data.reason).toBe("provider-disagreement");
    expect(mocks.discoverClaimAllCandidates).not.toHaveBeenCalled();
  });

  it("blocks when the independent registry provider is unavailable", async () => {
    mocks.discoverClaimAllRegistry
      .mockResolvedValueOnce(registry([primaryVault]))
      .mockResolvedValueOnce(
        unavailableOutcome(
          [
            readFailure(
              "claim-all-registry",
              "transport",
              "verifier down",
            ),
          ],
          metadata,
        ),
      );

    const outcome = await loadClaimAllPreflight({
      primaryClient,
      verifierClient,
      account,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "verifier-unavailable",
    });
    expect(mocks.discoverClaimAllCandidates).not.toHaveBeenCalled();
  });
});

describe("useClaimAllPreflight", () => {
  it("withholds cached ready data while staleTime-zero refetch is active", () => {
    const evaluation: ClaimAllPreflightEvaluation = {
      status: "ready",
      canReview: true,
      reason: null,
      candidateIds: [],
      progress: [],
    };
    const refetch = vi.fn();
    mocks.projectionSync.mockReturnValue({
      outcome: readyOutcome(evaluation, metadata),
      isLoading: true,
      isFetching: true,
      error: null,
      refetch,
    });

    const hook = renderHook(() => useClaimAllPreflight(account, true));
    expect(hook.result.current.evaluation).toBeUndefined();
    expect(hook.result.current.isLoading).toBe(true);

    mocks.projectionSync.mockReturnValue({
      outcome: readyOutcome(evaluation, metadata),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    });
    hook.rerender();
    expect(hook.result.current.evaluation).toBe(evaluation);
  });
});
