import { isAddressEqual } from "viem";
import { isFreshReady, type ReadOutcome } from "../read-outcome";
import { selectHydratedRoute } from "../router";
import {
  actionError,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
  type BorrowSnapshot,
} from "./types";

function hasCoherentBlock(snapshot: BorrowSnapshot): boolean {
  const outcomes: readonly ReadOutcome<unknown>[] = [
    snapshot.stream,
    snapshot.routing,
    snapshot.hydration,
    snapshot.quote,
  ];
  const blocks = outcomes.map((outcome) => outcome.metadata.blockNumber);
  if (blocks.some((block) => block === undefined) || !blocks.every((block) => block === blocks[0])) {
    return false;
  }
  const hashes = outcomes.map((outcome) => outcome.metadata.blockHash);
  const definedHashes = hashes.filter((hash) => hash !== undefined);
  return definedHashes.length === 0 || hashes.every((hash) => hash === definedHashes[0]);
}

export const borrowDefinition: ActionDefinition<"borrow"> = {
  type: "borrow",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (
      !isFreshReady(snapshot.stream) ||
      !isFreshReady(snapshot.routing) ||
      !isFreshReady(snapshot.hydration) ||
      !isFreshReady(snapshot.quote)
    ) {
      return invalidAction(
        actionError("snapshot-not-ready", "Borrow inputs are not all fresh and complete"),
      );
    }
    if (!hasCoherentBlock(snapshot)) {
      return invalidAction(
        actionError("snapshot-block-mismatch", "Borrow inputs do not describe one chain block"),
      );
    }
    if (snapshot.market.now >= snapshot.market.expiry) {
      return invalidAction(actionError("market-matured", "Borrowing closes at maturity"));
    }

    const stream = snapshot.stream.data;
    if (stream.streamId !== intent.streamId) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Stream state does not match the borrow intent"),
      );
    }
    if (!stream.eligible) {
      return invalidAction(actionError("stream-ineligible", "Stream is not eligible collateral"));
    }
    if (!isAddressEqual(stream.recipient, snapshot.identity.account)) {
      return invalidAction(
        actionError("stream-not-owned", "Connected account is not the stream recipient"),
      );
    }

    const routing = snapshot.routing.data;
    if (!isAddressEqual(routing.market, snapshot.market.market)) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Route state does not match the selected market"),
      );
    }
    const candidateIds = routing.candidateIds;
    if (
      candidateIds.length === 0 ||
      new Set(candidateIds).size !== candidateIds.length ||
      candidateIds.some((id) => id <= 0n)
    ) {
      return invalidAction(
        actionError("routing-incomplete", "Projected route identifiers are incomplete"),
      );
    }
    const positionsById = new Map(snapshot.hydration.data.positions.map((position) => [position.id, position]));
    if (
      positionsById.size !== snapshot.hydration.data.positions.length ||
      candidateIds.some((id) => !positionsById.has(id))
    ) {
      return invalidAction(
        actionError("routing-incomplete", "A projected route candidate lacks fresh hydration"),
      );
    }
    const projectedPositions = candidateIds.map((id) => positionsById.get(id)!);
    if (
      projectedPositions.some(
        (position) =>
          !isAddressEqual(position.market, snapshot.market.market) ||
          position.aprBps !== routing.aprBps ||
          position.availableLiquidity < 0n,
      )
    ) {
      return invalidAction(
        actionError("routing-incomplete", "Hydrated route data does not match the projected tick"),
      );
    }

    const selected = selectHydratedRoute({
      positions: projectedPositions,
      borrower: snapshot.identity.account,
      target: parsed.amount,
      aggregateDepth: routing.aggregateDepth,
      maxRouteIds: routing.maxRouteIds,
    });
    if (selected.status === "conservation-failed") {
      return invalidAction(
        actionError("routing-incomplete", "Projected and hydrated route depth do not conserve"),
      );
    }
    if (selected.status !== "ready") {
      return invalidAction(
        actionError("routing-insufficient", "Fresh public liquidity cannot fill this amount"),
      );
    }

    const quote = snapshot.quote.data;
    if (
      !isAddressEqual(quote.market, snapshot.market.market) ||
      quote.streamId !== intent.streamId ||
      quote.aprBps !== routing.aprBps ||
      quote.amount !== parsed.amount
    ) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Quote state does not match the reviewed borrow"),
      );
    }
    const net = quote.actualBorrow - quote.feeAmount;
    if (
      quote.actualBorrow <= 0n ||
      quote.feeAmount > quote.actualBorrow ||
      quote.obligation <= 0n ||
      quote.residual < 0n ||
      quote.minAcceptable <= 0n ||
      quote.minAcceptable > net
    ) {
      return invalidAction(actionError("quote-invalid", "Fresh borrow quote is invalid"));
    }
    const selectedAmounts = selected.selectedIds.map(
      (id) => positionsById.get(id)!.availableLiquidity,
    );
    const authorizations = [
      {
        kind: "erc721" as const,
        token: snapshot.market.sablier,
        spender: lending,
        tokenId: intent.streamId,
        satisfied:
          stream.approvedForAll ||
          (stream.approved !== null && isAddressEqual(stream.approved, lending)),
      },
    ];
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "borrow",
      args: [
        snapshot.market.market,
        routing.aprBps,
        parsed.amount,
        intent.streamId,
        quote.minAcceptable,
      ] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "BORROW",
      preconditions: [
        "fresh-stream",
        "fresh-projected-route",
        "fresh-hydration",
        "fresh-quote",
        "single-block",
        "route-conserved",
        "self-liquidity-excluded",
      ],
      authorizations,
      call,
      touchedResources: [
        ...selected.selectedIds.map((id) => ({ kind: "liquidity-position" as const, lending, id })),
        { kind: "market-depth", lending, market: snapshot.market.market, aprBps: routing.aprBps },
        { kind: "stream", sablier: snapshot.market.sablier, id: intent.streamId },
        {
          kind: "nft-approval",
          token: snapshot.market.sablier,
          owner: snapshot.identity.account,
          spender: lending,
          tokenId: intent.streamId,
        },
      ],
      route: {
        ids: selected.selectedIds,
        amounts: selectedAmounts,
        aprBps: routing.aprBps,
      },
      economics: {
        amount: parsed.amount,
        actualBorrow: quote.actualBorrow,
        feeAmount: quote.feeAmount,
        obligation: quote.obligation,
        residual: quote.residual,
        minAcceptable: quote.minAcceptable,
        selectedDepth: selected.selectedDepth,
        aprBps: routing.aprBps,
      },
      receiptSummary: {
        source: lending,
        eventName: "Borrowed",
        label: "BORROWED",
        expectedIds: [intent.streamId, ...selected.selectedIds],
        expectedAmounts: {
          borrowed: parsed.amount,
          minimumReceived: quote.minAcceptable,
          obligation: quote.obligation,
        },
      },
    });
  },
};
