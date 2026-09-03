import { describe, expect, it } from "vitest";
import {
  KD7_RETIRED_MARKET_COPY,
  NAMED_SURFACE_STATES,
  WAITING_FOR_LIQUIDITY_COPY,
  actionCardinality,
  namedSurfaceSpec,
  reviewLiveCopy,
  suppressStaleSubmit,
  txNamedState,
} from "@/lib/named-surface-state";

describe("named surface-state catalog", () => {
  it("lists every CS4-U5 named state", () => {
    expect(NAMED_SURFACE_STATES).toEqual([
      "wallet-disconnected",
      "unsupported-network",
      "no-supported-underlying",
      "underlying-choice",
      "insufficient-balance",
      "amount-out-of-range",
      "no-valid-terms",
      "market-moved",
      "liquidity-unavailable",
      "stream-ineligible",
      "waiting-for-liquidity",
      "no-borrower-demand-yet",
      "quote-refreshing",
      "transaction-rejected",
      "transaction-reverted",
      "transaction-pending",
      "transaction-confirmed",
      "transaction-unknown",
      "network-read-failure",
      "caught-render-error",
      "incomplete-portfolio",
      "empty-portfolio",
      "completed-position",
      "pt-claim-available",
      "unwrap-available",
      "retired-router",
      "retired-market",
    ]);
  });

  it("keeps at most one primary and one secondary on every named state", () => {
    for (const id of NAMED_SURFACE_STATES) {
      const spec = namedSurfaceSpec(id);
      const counts = actionCardinality(spec);
      expect(counts.primaries).toBeLessThanOrEqual(1);
      expect(counts.secondaries).toBeLessThanOrEqual(1);
    }
  });

  it("lets quote refreshing and pending render no primary and suppress submit", () => {
    const refreshing = namedSurfaceSpec("quote-refreshing");
    const pending = namedSurfaceSpec("transaction-pending");
    expect(refreshing.primary).toBeNull();
    expect(pending.primary).toBeNull();
    expect(refreshing.suppressSubmit).toBe(true);
    expect(pending.suppressSubmit).toBe(true);
    expect(suppressStaleSubmit({ refreshing: true, pending: false, marketMoved: false })).toBe(
      true,
    );
    expect(suppressStaleSubmit({ refreshing: false, pending: true, marketMoved: false })).toBe(
      true,
    );
  });

  it("announces quote refresh and each tx checkpoint through review live copy", () => {
    expect(reviewLiveCopy({ drifted: true, checkpoint: "sign" })).toBe(
      namedSurfaceSpec("quote-refreshing").copy,
    );
    expect(reviewLiveCopy({ drifted: false, checkpoint: "pending" })).toBe(
      namedSurfaceSpec("transaction-pending").copy,
    );
    expect(reviewLiveCopy({ drifted: false, checkpoint: "rejected" })).toBe(
      namedSurfaceSpec("transaction-rejected").copy,
    );
    expect(reviewLiveCopy({ drifted: false, checkpoint: "reverted" })).toBe(
      namedSurfaceSpec("transaction-reverted").copy,
    );
    expect(reviewLiveCopy({ drifted: false, checkpoint: "confirmed" })).toBe(
      namedSurfaceSpec("transaction-confirmed").copy,
    );
    expect(reviewLiveCopy({ drifted: false, checkpoint: "review" })).toBeNull();
  });

  it("keeps rejected, reverted, pending, confirmed, and unknown distinct", () => {
    expect(txNamedState("rejected")).toBe("transaction-rejected");
    expect(txNamedState("reverted")).toBe("transaction-reverted");
    expect(txNamedState("pending")).toBe("transaction-pending");
    expect(txNamedState("confirmed")).toBe("transaction-confirmed");
    expect(txNamedState("unknown")).toBe("transaction-unknown");
    const next = ["rejected", "reverted", "pending", "confirmed", "unknown"].map((status) => {
      const spec = namedSurfaceSpec(txNamedState(status as Parameters<typeof txNamedState>[0]));
      return { id: spec.id, primary: spec.primary?.id ?? null, suppressSubmit: spec.suppressSubmit };
    });
    expect(next).toEqual([
      { id: "transaction-rejected", primary: "retry", suppressSubmit: false },
      { id: "transaction-reverted", primary: "review-again", suppressSubmit: false },
      { id: "transaction-pending", primary: null, suppressSubmit: true },
      { id: "transaction-confirmed", primary: "view-detail", suppressSubmit: false },
      { id: "transaction-unknown", primary: "check-status", suppressSubmit: true },
    ]);
  });

  it("posts a request only when CS3 is available", () => {
    const blocked = namedSurfaceSpec("liquidity-unavailable", { cs3Available: false });
    const ready = namedSurfaceSpec("liquidity-unavailable", { cs3Available: true });
    expect(blocked.primary).toBeNull();
    expect(ready.primary).toEqual({ id: "post-request", label: "POST REQUEST" });
  });

  it("keeps unmatched Fixed Return withdrawable and does not promise a return", () => {
    const spec = namedSurfaceSpec("no-borrower-demand-yet");
    expect(spec.copy).toMatch(/No borrower demand yet/i);
    expect(spec.copy).toMatch(/withdrawable/i);
    expect(spec.copy).toMatch(/No promised return/i);
    expect(spec.copy).not.toMatch(/target return/i);
    expect(spec.primary).toEqual({ id: "withdraw", label: "WITHDRAW UNFILLED" });
  });

  it("requires refreshed review when the market moved", () => {
    const spec = namedSurfaceSpec("market-moved");
    expect(spec.primary).toEqual({ id: "review-again", label: "REVIEW AGAIN" });
    expect(spec.suppressSubmit).toBe(true);
    expect(suppressStaleSubmit({ refreshing: false, pending: false, marketMoved: true })).toBe(
      true,
    );
  });

  it("disables execute on a retired router and keeps cancel", () => {
    const spec = namedSurfaceSpec("retired-router");
    expect(spec.primary).toEqual({ id: "cancel-request", label: "CANCEL REQUEST" });
    expect(spec.secondary).toBeNull();
    expect(spec.copy).toMatch(/cancel/i);
    expect(spec.copy).not.toMatch(/execute/i);
  });

  it("uses the KD7 sentence and wind-down actions on a retired market", () => {
    const spec = namedSurfaceSpec("retired-market");
    expect(spec.copy).toBe(KD7_RETIRED_MARKET_COPY);
    expect(spec.primary?.id).toBe("finish-position");
    expect(spec.secondary?.id).toBe("withdraw");
    expect(spec.textActions.some((action) => action.id === "supply")).toBe(false);
    expect(spec.textActions.some((action) => action.id === "borrow")).toBe(false);
    expect(spec.textActions.some((action) => action.id === "post-request")).toBe(false);
  });

  it("states locked vested tokens and the maturity cancel exit", () => {
    const spec = namedSurfaceSpec("waiting-for-liquidity");
    expect(spec.copy).toBe(WAITING_FOR_LIQUIDITY_COPY);
    expect(spec.primary).toEqual({ id: "cancel-request", label: "CANCEL REQUEST" });
    expect(namedSurfaceSpec("waiting-for-liquidity", { disclosure: "default" }).secondary).toBeNull();
    expect(
      namedSurfaceSpec("waiting-for-liquidity", {
        disclosure: "advanced",
        executeAllowed: true,
      }).secondary,
    ).toEqual({ id: "execute-request", label: "EXECUTE" });
    expect(
      namedSurfaceSpec("waiting-for-liquidity", {
        disclosure: "advanced",
        retiredRouter: true,
        executeAllowed: true,
      }).secondary,
    ).toBeNull();
  });

  it("keeps PT claim and unwrap as separate named states", () => {
    const completed = namedSurfaceSpec("completed-position");
    const claim = namedSurfaceSpec("pt-claim-available");
    const unwrap = namedSurfaceSpec("unwrap-available");
    expect(completed.primary?.id).toBe("view-detail");
    expect(claim.primary?.id).toBe("claim-pt");
    expect(unwrap.primary?.id).toBe("unwrap");
    expect(completed.primary?.id).not.toBe(claim.primary?.id);
    expect(completed.primary?.id).not.toBe(unwrap.primary?.id);
  });

  it("never treats a network read failure as empty", () => {
    const failure = namedSurfaceSpec("network-read-failure");
    const empty = namedSurfaceSpec("empty-portfolio");
    expect(failure.id).not.toBe(empty.id);
    expect(failure.primary?.id).toBe("retry");
    expect(empty.primary?.id).toBe("create");
  });

  it("offers persisted-attempt resume on a caught render error", () => {
    const spec = namedSurfaceSpec("caught-render-error", { hasPersistedAttempt: true });
    expect(spec.primary).toEqual({ id: "resume-attempt", label: "RESUME ATTEMPT" });
    expect(spec.copy).toMatch(/resume/i);
    expect(spec.copy).not.toMatch(/restart/i);
  });
});
