import { isAddressEqual } from "viem";
import { ZERO_ADDRESS } from "../config";
import { isFreshReady } from "../read-outcome";
import {
  actionError,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
  type RequestBookBinding,
} from "./types";

function liveBook(binding: RequestBookBinding): boolean {
  return binding.book !== ZERO_ADDRESS && isAddressEqual(binding.book, binding.router);
}

export const postRequestDefinition: ActionDefinition<"post_request"> = {
  type: "post_request",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    const minParsed = parsePositiveAmount(intent.minAcceptable);
    if (!minParsed.ok) return invalidAction(minParsed.error);
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.stream) || !isFreshReady(snapshot.book)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Request post inputs are not all fresh and complete"),
      );
    }
    if (snapshot.market.now >= snapshot.market.expiry) {
      return invalidAction(actionError("market-matured", "Borrowing closes at maturity"));
    }
    const book = snapshot.book.data;
    if (!liveBook(book)) {
      return invalidAction(
        actionError("not-current-router", "Request book is not the current lending router"),
      );
    }
    const stream = snapshot.stream.data;
    if (stream.streamId !== intent.streamId) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Stream state does not match the request intent"),
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
    const authorizations = [
      {
        kind: "erc721" as const,
        token: snapshot.market.sablier,
        spender: book.book,
        tokenId: intent.streamId,
        satisfied:
          stream.approvedForAll ||
          (stream.approved !== null && isAddressEqual(stream.approved, book.book)),
      },
    ];
    const call = {
      target: book.book,
      contract: "request_book" as const,
      functionName: "post",
      args: [
        intent.streamId,
        snapshot.market.market,
        intent.aprBps,
        parsed.amount,
        minParsed.amount,
      ] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "POST REQUEST",
      preconditions: ["fresh-stream", "fresh-book", "router-is-book"],
      authorizations,
      call,
      touchedResources: [
        { kind: "stream", sablier: snapshot.market.sablier, id: intent.streamId },
        {
          kind: "nft-approval",
          token: snapshot.market.sablier,
          owner: snapshot.identity.account,
          spender: book.book,
          tokenId: intent.streamId,
        },
        { kind: "request", book: book.book, id: 0n },
      ],
      economics: {
        amount: parsed.amount,
        minAcceptable: minParsed.amount,
        aprBps: intent.aprBps,
      },
      receiptSummary: {
        source: book.book,
        eventName: "RequestPosted",
        label: "REQUEST POSTED",
        expectedIds: [intent.streamId],
        expectedAmounts: {
          targetBorrow: parsed.amount,
          minAcceptable: minParsed.amount,
        },
      },
    });
  },
};

export const executeRequestDefinition: ActionDefinition<"execute_request"> = {
  type: "execute_request",
  build(intent, snapshot) {
    if (!isFreshReady(snapshot.request) || !isFreshReady(snapshot.book)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Request execute inputs are not all fresh and complete"),
      );
    }
    const book = snapshot.book.data;
    if (!liveBook(book)) {
      return invalidAction(
        actionError("not-current-router", "Request book is not the current lending router"),
      );
    }
    const request = snapshot.request.data;
    if (!request || request.requestId !== intent.requestId || request.streamId === 0n) {
      return invalidAction(actionError("request-missing", "Resting request is missing"));
    }
    const call = {
      target: book.book,
      contract: "request_book" as const,
      functionName: "execute",
      args: [intent.requestId] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "EXECUTE REQUEST",
      preconditions: ["fresh-request", "router-is-book"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "request", book: book.book, id: intent.requestId },
        { kind: "stream", sablier: snapshot.market.sablier, id: request.streamId },
      ],
      economics: {
        targetBorrow: request.targetBorrow,
        minAcceptable: request.minAcceptable,
        aprBps: request.aprBps,
      },
      receiptSummary: {
        source: book.book,
        eventName: "RequestFilled",
        label: "REQUEST FILLED",
        expectedIds: [intent.requestId],
        expectedAmounts: { targetBorrow: request.targetBorrow },
      },
    });
  },
};

export const cancelRequestDefinition: ActionDefinition<"cancel_request"> = {
  type: "cancel_request",
  build(intent, snapshot) {
    if (!isFreshReady(snapshot.request) || !isFreshReady(snapshot.book)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Request cancel inputs are not all fresh and complete"),
      );
    }
    const request = snapshot.request.data;
    if (!request || request.requestId !== intent.requestId || request.streamId === 0n) {
      return invalidAction(actionError("request-missing", "Resting request is missing"));
    }
    if (!isAddressEqual(request.borrower, snapshot.identity.account)) {
      return invalidAction(
        actionError("request-not-borrower", "Connected account is not the request borrower"),
      );
    }
    const book = snapshot.book.data.book;
    if (book === ZERO_ADDRESS) {
      return invalidAction(actionError("market-not-configured", "Request book is missing"));
    }
    const call = {
      target: book,
      contract: "request_book" as const,
      functionName: "cancel",
      args: [intent.requestId] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CANCEL REQUEST",
      preconditions: ["fresh-request", "borrower-only"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "request", book, id: intent.requestId },
        { kind: "stream", sablier: snapshot.market.sablier, id: request.streamId },
      ],
      economics: { streamId: request.streamId },
      receiptSummary: {
        source: book,
        eventName: "RequestCancelled",
        label: "REQUEST CANCELLED",
        expectedIds: [intent.requestId, request.streamId],
        expectedAmounts: {},
      },
    });
  },
};
