import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import ts from "typescript";
import {
  acceptScopedResult,
  adaptBatch,
  adaptBlockPinnedHydration,
  adaptVaultRegistryChunks,
  buildBorrowShadowView,
  buildPortfolioShadowView,
  buildRecoveryOutcome,
  combinePortfolioSourceOutcomes,
  createDiscoveryScope,
  decodeRecoveryCandidatesFromReceipt,
  planAprDepthReads,
  planShadowRequests,
  planBlockPinnedHydration,
  toVaultRegistryOutcome,
  type ShadowHydration,
  type ShadowRouting,
} from "@/lib/discovery/shadow-adapters";
import {
  loadingOutcome,
  partialOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
} from "@/lib/read-outcome";
import { ovrfloAbi, ovrfloLendingAbi } from "@/lib/abis";
import { discoverStreamCandidates } from "@/lib/discovery/stream-discovery";

function address(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

describe("shadow discovery adapters", () => {
  it("Covers AE1-AE2. keeps successful siblings under partial and reserves ready-empty for complete success", () => {
    const partial = adaptBatch({
      source: "hydration",
      results: [
        { status: "success", value: { id: 1n, amount: 50n } },
        { status: "failure", error: new Error("middle subcall reverted"), entityId: 2n },
        { status: "success", value: { id: 3n, amount: 25n } },
      ],
      metadata: { scopeKey: "market:1", blockNumber: 100n },
    });

    expect(partial).toMatchObject({
      status: "partial",
      complete: false,
      data: [
        { id: 1n, amount: 50n },
        { id: 3n, amount: 25n },
      ],
      failures: [
        {
          source: "hydration",
          code: "subcall",
          message: "middle subcall reverted",
          entityId: "2",
        },
      ],
    });

    expect(
      adaptBatch({
        source: "hydration",
        results: [],
        metadata: { scopeKey: "market:empty" },
      }),
    ).toMatchObject({ status: "ready", complete: true, data: [] });

    expect(
      adaptBatch({
        source: "hydration",
        results: [{ status: "failure", error: "RPC unavailable" }],
        metadata: { scopeKey: "market:failed" },
      }),
    ).toMatchObject({ status: "unavailable", complete: false });
  });

  it("preserves valid exclusions without making a complete batch partial", () => {
    const outcome = adaptBatch({
      source: "hydration",
      results: [
        { status: "excluded", reason: "unwritten slot" },
        { status: "success", value: 7n },
        { status: "excluded", reason: "foreign owner" },
      ],
      metadata: { scopeKey: "positions:alice" },
    });

    expect(outcome).toMatchObject({ status: "ready", complete: true, data: [7n] });
    expect(outcome.failures).toEqual([]);
  });

  it("bounds projected-candidate hydration into block-pinned chunks and reports limit/subcall failures", () => {
    const plan = planBlockPinnedHydration({
      candidateIds: [1n, 2n, 3n, 4n, 5n],
      blockNumber: 100n,
      maxCandidates: 4,
      chunkSize: 2,
    });
    expect(plan).toEqual({
      blockNumber: 100n,
      requestedCandidateIds: [1n, 2n, 3n, 4n],
      chunks: [
        [1n, 2n],
        [3n, 4n],
      ],
      candidateLimitHit: true,
    });

    const outcome = adaptBlockPinnedHydration({
      source: "liquidity-hydration",
      plan,
      chunks: [
        {
          blockNumber: 100n,
          results: [
            { status: "success", value: { id: 1n, amount: 50n } },
            { status: "failure", error: "position 2 reverted", entityId: 2n },
          ],
        },
        {
          blockNumber: 100n,
          results: [
            { status: "success", value: { id: 3n, amount: 25n } },
            { status: "success", value: { id: 4n, amount: 10n } },
          ],
        },
      ],
      metadata: { scopeKey: "borrow:alice" },
    });

    expect(outcome).toMatchObject({
      status: "partial",
      complete: false,
      metadata: { scopeKey: "borrow:alice", blockNumber: 100n },
      data: {
        blockNumber: 100n,
        candidateIds: [1n, 2n, 3n, 4n],
        values: [
          { id: 1n, amount: 50n },
          { id: 3n, amount: 25n },
          { id: 4n, amount: 10n },
        ],
      },
    });
    expect(outcome.failures.map((failure) => failure.code)).toEqual(["subcall", "fragmented"]);
  });

  it("rejects hydration returned from a different block instead of mixing snapshots", () => {
    const plan = planBlockPinnedHydration({
      candidateIds: [1n],
      blockNumber: 100n,
      maxCandidates: 4,
      chunkSize: 2,
    });
    const outcome = adaptBlockPinnedHydration({
      source: "liquidity-hydration",
      plan,
      chunks: [
        {
          blockNumber: 101n,
          results: [{ status: "success", value: { id: 1n, amount: 50n } }],
        },
      ],
      metadata: { scopeKey: "borrow:alice" },
    });

    expect(outcome).toMatchObject({ status: "unavailable", complete: false });
    expect(outcome.failures[0]).toMatchObject({
      code: "invalid",
      message: "Hydration chunk 0 returned block 101 instead of pinned block 100",
    });
  });

  it("fails closed for missing, short, extra, or excluded hydration results", () => {
    const plan = planBlockPinnedHydration({
      candidateIds: [1n, 2n],
      blockNumber: 100n,
      maxCandidates: 2,
      chunkSize: 2,
    });
    const missing = adaptBlockPinnedHydration({
      source: "hydration",
      plan,
      chunks: [],
    });
    expect(missing).toMatchObject({
      status: "unavailable",
      failures: [{ code: "incomplete" }],
    });

    const short = adaptBlockPinnedHydration({
      source: "hydration",
      plan,
      chunks: [
        {
          blockNumber: 100n,
          results: [{ status: "success", value: { id: 1n } }],
        },
      ],
    });
    expect(short).toMatchObject({
      status: "partial",
      data: { values: [{ id: 1n }] },
      failures: [{ code: "incomplete" }],
    });

    const excluded = adaptBlockPinnedHydration({
      source: "hydration",
      plan: planBlockPinnedHydration({
        candidateIds: [1n],
        blockNumber: 100n,
        maxCandidates: 1,
        chunkSize: 1,
      }),
      chunks: [
        {
          blockNumber: 100n,
          results: [{ status: "excluded", reason: "foreign candidate" }],
        },
      ],
    });
    expect(excluded).toMatchObject({
      status: "unavailable",
      failures: [{ code: "invalid", index: 0, entityId: "1" }],
    });

    const extra = adaptBlockPinnedHydration({
      source: "hydration",
      plan,
      chunks: [
        {
          blockNumber: 100n,
          results: [
            { status: "success", value: { id: 1n } },
            { status: "success", value: { id: 2n } },
          ],
        },
        { blockNumber: 100n, results: [] },
      ],
    });
    expect(extra).toMatchObject({
      status: "partial",
      data: { values: [{ id: 1n }, { id: 2n }] },
      failures: [{ code: "invalid" }],
    });
  });

  it("keeps fresh public depth visible while routing degrades and gates Borrow on all three fresh-ready outcomes", () => {
    const depth = readyOutcome({ publicDepth: 150n }, { scopeKey: "market:1", blockNumber: 100n });
    const routingFailure = readFailure("routing", "transport", "historical RPC unavailable");

    for (const routing of [
      loadingOutcome<ShadowRouting>(),
      partialOutcome(
        { executableDepth: 50n, fragmentedDepth: 100n, selfExcludedDepth: 0n },
        [routingFailure],
        { scopeKey: "market:1" },
      ),
      readyOutcome(
        { executableDepth: 50n, fragmentedDepth: 100n, selfExcludedDepth: 0n },
        { scopeKey: "market:1" },
        "stale",
      ),
      unavailableOutcome<ShadowRouting>([routingFailure], { scopeKey: "market:1" }),
    ]) {
      const view = buildBorrowShadowView({
        depth,
        routing,
        hydration: loadingOutcome<ShadowHydration>(),
      });
      expect(view.publicDepth).toBe(150n);
      expect(view.borrowEnabled).toBe(false);
      expect(view.primaryAmount).toBeNull();
    }

    const routing = readyOutcome(
      { executableDepth: 50n, fragmentedDepth: 75n, selfExcludedDepth: 25n },
      { scopeKey: "market:1", blockNumber: 100n },
    );
    const hydration = readyOutcome<ShadowHydration>(
      { status: "ready", selectedIds: [1n, 4n], selectedDepth: 50n },
      { scopeKey: "market:1", blockNumber: 100n },
    );
    const ready = buildBorrowShadowView({ depth, routing, hydration });

    expect(ready).toMatchObject({
      borrowEnabled: true,
      primaryLabel: "EXECUTABLE LIQUIDITY",
      primaryAmount: 50n,
      secondary: [
        { label: "PUBLIC DEPTH", amount: 150n, reason: "aggregate market liquidity" },
        { label: "FRAGMENTED DEPTH", amount: 75n, reason: "outside the bounded executable route" },
        { label: "SELF-EXCLUDED DEPTH", amount: 25n, reason: "supplied by the connected borrower" },
      ],
    });

    const mismatched = buildBorrowShadowView({
      depth,
      routing,
      hydration: readyOutcome<ShadowHydration>(
        { status: "ready", selectedIds: [1n], selectedDepth: 50n },
        { scopeKey: "market:1", blockNumber: 101n },
      ),
    });
    expect(mismatched).toMatchObject({
      borrowEnabled: false,
      primaryAmount: null,
      message: "Depth, routing, and hydration must share one pinned block.",
    });

    for (const [status, message] of [
      ["fragmented", "Liquidity is too fragmented for the bounded route."],
      ["insufficient", "Executable liquidity is insufficient."],
      ["conservation-failed", "Executable liquidity is insufficient."],
    ] as const) {
      expect(
        buildBorrowShadowView({
          depth,
          routing,
          hydration: readyOutcome<ShadowHydration>(
            { status, selectedIds: [], selectedDepth: 0n },
            { scopeKey: "market:1", blockNumber: 100n },
          ),
        }),
      ).toMatchObject({ borrowEnabled: false, message });
    }
  });

  it("Covers AE32. shows a connected portfolio entry with unknown metrics and one load action before discovery", () => {
    expect(buildPortfolioShadowView({ state: "connected-idle" })).toEqual({
      visible: true,
      state: "unloaded",
      metrics: null,
      loadAction: { label: "LOAD PORTFOLIO" },
      recoveryAvailable: false,
      message: "Portfolio values have not been loaded.",
    });

    expect(
      buildPortfolioShadowView({
        state: "connected-started",
        outcome: readyOutcome(
          { supplied: 0n, loans: 0, streams: 0, claimable: 0n },
          { scopeKey: "portfolio:alice" },
        ),
      }),
    ).toMatchObject({ state: "empty", metrics: { supplied: 0n, loans: 0, streams: 0, claimable: 0n } });

    expect(
      buildPortfolioShadowView({
        state: "connected-started",
        outcome: unavailableOutcome(
          [readFailure("portfolio", "transport", "RPC unavailable")],
          { scopeKey: "portfolio:alice" },
        ),
      }),
    ).toMatchObject({ state: "unavailable", metrics: null, recoveryAvailable: true });
  });

  it("keeps successful personal sources visible and unknown failed-source metrics non-zeroed under partial", () => {
    const outcome = combinePortfolioSourceOutcomes(
      {
        supplied: readyOutcome({ supplied: 50n }, { scopeKey: "positions:alice" }),
        loans: readyOutcome({ loans: 2 }, { scopeKey: "loans:alice" }),
        streams: unavailableOutcome(
          [readFailure("held-streams", "transport", "historical RPC unavailable")],
          { scopeKey: "streams:alice" },
        ),
        claimable: loadingOutcome(),
      },
      { scopeKey: "portfolio:alice" },
    );

    expect(outcome).toMatchObject({
      status: "partial",
      data: {
        supplied: 50n,
        loans: 2,
        streams: null,
        claimable: null,
      },
    });
    expect(outcome.failures.map((failure) => failure.source)).toEqual([
      "held-streams",
      "claimable",
    ]);
  });

  it("Covers AE25, AE30, AE34. recovery verifies candidates directly without completing portfolio or Claim All", () => {
    const outcome = buildRecoveryOutcome({
      source: "transaction-hash",
      candidates: [
        {
          kind: "stream",
          id: 1n,
          read: { status: "success", value: { status: "nonexistent" } },
        },
        {
          kind: "liquidity",
          id: 2n,
          read: {
            status: "success",
            value: {
              status: "existing",
              relation: "foreign",
              eligible: true,
              completed: false,
            },
          },
        },
        {
          kind: "loan",
          id: 3n,
          read: {
            status: "success",
            value: {
              status: "existing",
              relation: "contributor",
              eligible: false,
              completed: false,
            },
          },
        },
        {
          kind: "pool",
          id: 4n,
          read: {
            status: "success",
            value: {
              status: "existing",
              relation: "contributor",
              eligible: true,
              completed: true,
            },
          },
        },
        {
          kind: "stream",
          id: 5n,
          read: {
            status: "success",
            value: {
              status: "existing",
              relation: "owner",
              eligible: true,
              completed: false,
            },
          },
        },
      ],
      metadata: { scopeKey: "recovery:alice" },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      data: {
        source: "transaction-hash",
        portfolioComplete: false,
        claimAllComplete: false,
        candidates: [
          { id: 1n, status: "nonexistent" },
          { id: 2n, status: "foreign" },
          { id: 3n, status: "ineligible" },
          { id: 4n, status: "completed" },
          { id: 5n, status: "actionable" },
        ],
      },
    });
  });

  it("Covers AE30. decodes protocol receipt logs into scoped, deduplicated recovery candidates", () => {
    const vault = address(100);
    const lending = address(101);
    const unrelated = address(102);
    const user = address(1);
    const market = address(2);
    const liquidityTopics = encodeEventTopics({
      abi: ovrfloLendingAbi,
      eventName: "LiquiditySupplied",
      args: { liquidityId: 7n, lender: user, market },
    }) as unknown as readonly Hex[];
    const loanTopics = encodeEventTopics({
      abi: ovrfloLendingAbi,
      eventName: "BorrowerLoanPoolCreated",
      args: { loanId: 9n, borrower: user, market },
    }) as unknown as readonly Hex[];
    const depositTopics = encodeEventTopics({
      abi: ovrfloAbi,
      eventName: "Deposited",
      args: { user, market },
    }) as unknown as readonly Hex[];

    const candidates = decodeRecoveryCandidatesFromReceipt(
      [
        {
          address: lending,
          topics: liquidityTopics,
          data: encodeAbiParameters(
            [{ type: "uint16" }, { type: "uint128" }],
            [1_000, 50n],
          ),
        },
        {
          address: lending,
          topics: loanTopics,
          data: encodeAbiParameters(
            [{ type: "uint16" }, { type: "uint128" }],
            [1_100, 75n],
          ),
        },
        {
          address: vault,
          topics: depositTopics,
          data: encodeAbiParameters(
            [
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [100n, 20n, 80n, 11n],
          ),
        },
        // A valid-looking protocol event from an unverified address is not a candidate.
        {
          address: unrelated,
          topics: liquidityTopics,
          data: encodeAbiParameters(
            [{ type: "uint16" }, { type: "uint128" }],
            [1_000, 50n],
          ),
        },
        // Duplicate receipt logs do not duplicate direct hydration work.
        {
          address: lending,
          topics: liquidityTopics,
          data: encodeAbiParameters(
            [{ type: "uint16" }, { type: "uint128" }],
            [1_000, 50n],
          ),
        },
      ],
      { lendingAddresses: [lending], vaultAddresses: [vault] },
    );

    expect(candidates).toEqual([
      { kind: "liquidity", id: 7n },
      { kind: "loan", id: 9n },
      { kind: "pool", id: 9n },
      { kind: "stream", id: 11n },
    ]);
  });

  it("discards late results after account, chain, market, APR, or modal scope changes", () => {
    const originalIdentity = {
      account: address(1),
      chainId: 1,
      factory: address(2),
      market: address(3),
      aprBps: 1_000,
      modal: "borrow",
    };
    const original = createDiscoveryScope(originalIdentity);
    const result = readyOutcome([1n], { scopeKey: original });

    expect(acceptScopedResult(original, original, result)).toEqual({ accepted: true, outcome: result });

    for (const current of [
      createDiscoveryScope({ ...originalIdentity, account: address(9) }),
      createDiscoveryScope({ ...originalIdentity, chainId: 11_155_111 }),
      createDiscoveryScope({ ...originalIdentity, factory: address(7) }),
      createDiscoveryScope({ ...originalIdentity, market: address(8) }),
      createDiscoveryScope({ ...originalIdentity, aprBps: 1_100 }),
      createDiscoveryScope({ ...originalIdentity, modal: "supply" }),
    ]) {
      const accepted = acceptScopedResult(original, current, result);
      expect(accepted.accepted).toBe(false);
      if (!accepted.accepted) {
        expect(accepted.failure.code).toBe("cancelled");
      }
    }
  });

  it("Covers AE20 and AE36. registry enumeration is chunked and a middle failure prevents origin exclusion", () => {
    const registry = adaptVaultRegistryChunks({
      expectedCount: 5,
      maxExpectedCount: 100,
      chunkSize: 2,
      chunks: [
        {
          start: 0,
          results: [
            { status: "success", value: address(10) },
            { status: "success", value: address(11) },
          ],
        },
        {
          start: 2,
          results: [
            { status: "failure", error: "registry subcall failed" },
            { status: "success", value: address(13) },
          ],
        },
        { start: 4, results: [{ status: "success", value: address(14) }] },
      ],
      metadata: { scopeKey: "factory:1", blockNumber: 100n },
    });

    expect(registry).toMatchObject({
      status: "partial",
      data: [address(10), address(11), address(13), address(14)],
    });
    expect(toVaultRegistryOutcome(registry)).toMatchObject({
      status: "partial",
      vaults: [address(10), address(11), address(13), address(14)],
    });
    expect(
      discoverStreamCandidates({
        vaultRegistry: toVaultRegistryOutcome(registry),
        origins: [{ vault: address(10), streamId: 1n }],
        recipientTransfers: [{ streamId: 1n, to: address(1) }],
        recipient: address(1),
        candidateLimit: 10,
      }),
    ).toMatchObject({ status: "unavailable", candidateIds: [] });

    const complete = adaptVaultRegistryChunks({
      expectedCount: 5,
      maxExpectedCount: 100,
      chunkSize: 2,
      chunks: [
        { start: 0, results: [{ status: "success", value: address(10) }, { status: "success", value: address(11) }] },
        { start: 2, results: [{ status: "success", value: address(12) }, { status: "success", value: address(13) }] },
        { start: 4, results: [{ status: "success", value: address(14) }] },
      ],
      metadata: { scopeKey: "factory:1", blockNumber: 101n },
    });
    expect(complete).toMatchObject({ status: "ready", complete: true });
    expect(toVaultRegistryOutcome(complete)).toEqual({
      status: "complete",
      vaults: [address(10), address(11), address(12), address(13), address(14)],
    });
  });

  it("fails closed before allocating registry slots beyond the explicit read budget", () => {
    const outcome = adaptVaultRegistryChunks({
      expectedCount: 101,
      maxExpectedCount: 100,
      chunkSize: 20,
      chunks: [],
    });

    expect(outcome).toMatchObject({
      status: "unavailable",
      failures: [
        {
          code: "incomplete",
          message: "Vault registry count 101 exceeds read budget 100",
        },
      ],
    });
  });

  it("starts only the reads owned by the visible surface", () => {
    expect(planShadowRequests({ surface: "markets", portfolioLoaded: false })).toEqual(["market-depth"]);
    expect(planShadowRequests({ surface: "borrow", portfolioLoaded: false })).toEqual([
      "market-depth",
      "apr-depth",
      "routing",
      "selected-hydration",
    ]);
    expect(planShadowRequests({ surface: "portfolio", portfolioLoaded: false })).toEqual([]);
    expect(planShadowRequests({ surface: "portfolio", portfolioLoaded: true })).toEqual([
      "lender-positions",
      "borrower-loans",
      "demand",
      "held-streams",
    ]);
    expect(planShadowRequests({ surface: "claim-all", portfolioLoaded: false })).toEqual([
      "lender-positions",
      "borrower-loans",
      "demand",
      "held-streams",
      "claim-all-corroboration",
    ]);
  });

  it("keeps APR depth lazy and bounded to the fixed 0-10,000 bps domain", () => {
    expect(planAprDepthReads({ marketOpen: false, borrowOpen: false })).toEqual([]);
    for (const intent of [
      { marketOpen: true, borrowOpen: false },
      { marketOpen: false, borrowOpen: true },
    ]) {
      const ticks = planAprDepthReads(intent);
      expect(ticks).toHaveLength(101);
      expect(ticks[0]).toBe(0);
      expect(ticks[100]).toBe(10_000);
      expect(ticks.every((tick, index) => tick === index * 100)).toBe(true);
    }
  });

  it("keeps the replacement adapters shadow/test-only until U9", () => {
    const productionFiles = readdirSync(process.cwd(), {
      recursive: true,
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isFile() &&
          [".ts", ".tsx"].includes(extname(entry.name)) &&
          !entry.parentPath.includes("/tests/") &&
          !entry.parentPath.includes("/node_modules/"),
      )
      .map((entry) => resolve(entry.parentPath, entry.name))
      .filter((file) => !file.endsWith("/lib/discovery/shadow-adapters.ts"));

    const forbiddenImports: string[] = [];
    for (const file of productionFiles) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node) => {
        const moduleSpecifier =
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : ts.isCallExpression(node) &&
                node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                node.arguments.length === 1 &&
                ts.isStringLiteral(node.arguments[0])
              ? node.arguments[0].text
              : null;
        if (moduleSpecifier?.endsWith("discovery/shadow-adapters")) {
          forbiddenImports.push(file);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(sourceFile);
    }
    expect(forbiddenImports).toEqual([]);

    // U8 makes ActionModal a composition surface and moves the temporary
    // legacy Borrow bridge into its extracted flow. U9 owns replacing this
    // bridge, so assert against the live flow rather than its router.
    const borrowFlow = readFileSync(resolve(process.cwd(), "components/action-flow/BorrowFlow.tsx"), "utf8");
    expect(borrowFlow).toContain('functionName: "gatherLiquidity"');
  });
});
