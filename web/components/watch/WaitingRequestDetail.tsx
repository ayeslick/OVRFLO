"use client";

import { isAddressEqual, type Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { ActionButton } from "@/components/kit/ActionButton";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { ovrfloLendingAbi, ovrfloRequestBookAbi } from "@/lib/abis";
import type { DisclosureLevel } from "@/lib/disclosure";
import { formatAprBps, formatTruncatedDecimal } from "@/lib/format";
import {
  namedSurfaceSpec,
  WAITING_FOR_LIQUIDITY_COPY,
} from "@/lib/named-surface-state";
import type { RestingRequestRow } from "@/lib/protocol/request-book";
import type { MarketInfo } from "@/lib/types";
import { userFacingError } from "@/lib/errors";
import "./watch.css";

export function WaitingRequestDetail({
  request,
  market,
  symbol,
  signingAllowed,
  disclosure,
}: {
  request: RestingRequestRow;
  market: MarketInfo | null;
  symbol: string;
  signingAllowed: boolean;
  disclosure: DisclosureLevel;
}) {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const routerRead = useReadContract({
    address: request.lending,
    abi: ovrfloLendingAbi,
    functionName: "router",
    query: { enabled: Boolean(request.lending) },
  });
  const router = (routerRead.data as Address | undefined) ?? null;
  const retiredRouter = router !== null && !isAddressEqual(router, request.book);
  const executeAllowed = router !== null && isAddressEqual(router, request.book);
  const spec = namedSurfaceSpec(retiredRouter ? "retired-router" : "waiting-for-liquidity", {
    disclosure,
    executeAllowed,
    retiredRouter,
  });
  const { actionTx } = useApprovalWriteFlows(
    account,
    market ? { ...market, lending: request.lending, requestBook: request.book } : [],
  );
  const pending = actionTx.isConfirming;
  const stale = !signingAllowed;
  const blocked = stale || pending || actionTx.isUnknown;

  function onCancel() {
    if (blocked) return;
    actionTx.writeContract({
      address: request.book,
      abi: ovrfloRequestBookAbi,
      functionName: "cancel",
      args: [request.requestId],
    });
  }

  function onExecute() {
    if (blocked || !spec.secondary) return;
    actionTx.writeContract({
      address: request.book,
      abi: ovrfloRequestBookAbi,
      functionName: "execute",
      args: [request.requestId],
    });
  }

  return (
    <article
      data-ui="UI-WATCH-WAITING-REQUEST"
      data-region="waiting-request"
      data-named-state={spec.id}
    >
      <div className="kit-hero">
        <span className="kit-hero-kicker">{spec.label.toUpperCase()}</span>
        <p className="watch-hero-meta">STREAM #{request.streamId.toString()}</p>
      </div>
      <p className="watch-note">{WAITING_FOR_LIQUIDITY_COPY}</p>
      {retiredRouter ? <p className="watch-note">{spec.copy}</p> : null}
      <dl className="watch-facts">
        <div className="watch-fact">
          <dt>TARGET</dt>
          <dd>{`${formatTruncatedDecimal(request.targetBorrow, 18, 5)} ${symbol}`}</dd>
        </div>
        <div className="watch-fact">
          <dt>APR</dt>
          <dd>{formatAprBps(request.aprBps)}</dd>
        </div>
        <div className="watch-fact">
          <dt>STREAM</dt>
          <dd>{`#${request.streamId.toString()}`}</dd>
        </div>
      </dl>
      {actionTx.error && !actionTx.isRejected ? (
        <p className="kit-field-error">{userFacingError(actionTx.error)}</p>
      ) : null}
      {actionTx.isConfirmed ? (
        <p className="watch-note" data-named-state="transaction-confirmed">
          REQUEST UPDATED
        </p>
      ) : null}
      {actionTx.isRejected ? (
        <div className="watch-actions" data-named-state="transaction-rejected">
          <ActionButton variant="primary" onClick={onCancel}>
            RETRY
          </ActionButton>
        </div>
      ) : null}
      {actionTx.isReverted ? (
        <div className="watch-actions" data-named-state="transaction-reverted">
          <ActionButton variant="primary" onClick={onCancel}>
            REVIEW AGAIN
          </ActionButton>
        </div>
      ) : null}
      {actionTx.isUnknown ? (
        <p className="watch-note" data-named-state="transaction-unknown">
          TRANSACTION OUTCOME UNKNOWN — DO NOT SUBMIT AGAIN
        </p>
      ) : null}
      {pending ? (
        <p className="watch-note" data-named-state="transaction-pending">
          TRANSACTION PENDING — SAFE TO LEAVE
        </p>
      ) : !actionTx.isConfirmed &&
        !actionTx.isRejected &&
        !actionTx.isReverted &&
        !actionTx.isUnknown ? (
        <div className="watch-actions">
          {spec.primary ? (
            blocked ? (
              <ActionButton
                disabled
                disabledReason={
                  stale
                    ? "EVENTS STALE — SIGNING DISABLED"
                    : actionTx.isUnknown
                      ? "A TRANSACTION MAY ALREADY BE IN PROGRESS"
                      : "TRANSACTION PENDING"
                }
              >
                {spec.primary.label}
              </ActionButton>
            ) : (
              <ActionButton
                variant="primary"
                busy={actionTx.isSigning || actionTx.isInFlight}
                onClick={onCancel}
              >
                {spec.primary.label}
              </ActionButton>
            )
          ) : null}
          {spec.secondary ? (
            blocked ? (
              <ActionButton disabled disabledReason="EXECUTE STAYS CLOSED WHILE A WRITE IS OPEN">
                {spec.secondary.label}
              </ActionButton>
            ) : (
              <ActionButton busy={actionTx.isSigning || actionTx.isInFlight} onClick={onExecute}>
                {spec.secondary.label}
              </ActionButton>
            )
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
