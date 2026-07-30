import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ClaimAllPreflightEvaluation } from "@/lib/claim-all";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const LENDING = "0x00000000000000000000000000000000000000aa" as Address;
const ASSET = "0x00000000000000000000000000000000000000cc" as Address;
function readyPreflight(
  pools: { lending: Address; loanId: bigint; claimable: bigint; asset: Address }[],
  streams: { streamId: bigint; withdrawable: bigint; asset: Address }[],
): ClaimAllPreflightEvaluation {
  return {
    status: "ready",
    canReview: true,
    reason: null,
    candidateIds: [
      ...pools
        .filter((pool) => pool.claimable > 0n)
        .map(
          (pool) =>
            `pool:${pool.lending.toLowerCase()}:${pool.loanId}` as const,
        ),
      ...streams
        .filter((stream) => stream.withdrawable > 0n)
        .map((stream) => `stream:${stream.streamId}` as const),
    ].sort(),
    progress: [
      { source: "markets", status: "complete", retryable: false, message: "complete" },
      { source: "streams", status: "complete", retryable: false, message: "complete" },
      { source: "hydration", status: "complete", retryable: false, message: "complete" },
      { source: "verifier", status: "complete", retryable: false, message: "complete" },
    ],
  };
}

const queueState = {
  start: vi.fn(),
  resume: vi.fn(),
  acceptReview: vi.fn(),
  rows: [] as unknown[],
  statusOf: () => "pending" as const,
  running: false,
  paused: false,
  needsReview: false,
  failed: false,
  error: null,
  inFlight: false,
  done: false,
};

vi.mock("@/hooks/useTxQueue", () => ({ useTxQueue: () => queueState }));
vi.mock("@/hooks/useFocusTrap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/hooks/useEscapeKey", () => ({ useEscapeKey: () => {} }));

import { ClaimAllModal } from "@/components/ClaimAllModal";

// R41/M-6 plus U7: the plan shown in review is frozen, while confirm compares it
// with current props and U6 rebuilds it from chain. A changed plan is shown for
// another explicit review; spent work is never blindly submitted.
function renderModal(props: {
  pools?: { lending: Address; loanId: bigint; claimable: bigint; asset: Address }[];
  streams?: { streamId: bigint; withdrawable: bigint; asset: Address }[];
}) {
  const pools = props.pools ?? [];
  const streams = props.streams ?? [];
  const { rerender, ...rest } = render(
    <ClaimAllModal
      pools={pools}
      streams={streams}
      user={USER}
      onClose={vi.fn()}
      preflight={readyPreflight(pools, streams)}
    />,
  );
  return { rerender, ...rest };
}

describe("ClaimAllModal — plan freshness (R41)", () => {
  beforeEach(() => {
    queueState.start = vi.fn();
    queueState.resume = vi.fn();
    queueState.acceptReview = vi.fn();
    queueState.rows = [];
    queueState.done = false;
    queueState.failed = false;
    queueState.paused = false;
    queueState.needsReview = false;
    queueState.inFlight = false;
  });

  it("shows a changed plan for another explicit review before submitting it", () => {
    const streams = [{ streamId: 1n, withdrawable: 5n, asset: ASSET }];
    const { rerender } = renderModal({ streams });
    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));

    // The stream is claimed elsewhere while its row is under review, and a
    // second one appears. The next click refreshes the visible review and does
    // not submit unseen work.
    rerender(
      <ClaimAllModal
        pools={[]}
        streams={[
          { streamId: 1n, withdrawable: 0n, asset: ASSET },
          { streamId: 2n, withdrawable: 9n, asset: ASSET },
        ]}
        user={USER}
        onClose={vi.fn()}
        preflight={readyPreflight([], [
          { streamId: 2n, withdrawable: 9n, asset: ASSET },
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));
    expect(queueState.start).not.toHaveBeenCalled();
    expect(
      screen.getByText(/CLAIMS CHANGED WHILE REVIEWING/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.start).toHaveBeenCalledTimes(1);
    const submitted = queueState.start.mock.calls[0][0] as { streamId?: bigint }[];
    // Only the still-claimable stream, and the newly claimable one.
    expect(submitted.map((tx) => tx.streamId)).toEqual([2n]);
  });

  it("says so rather than queueing nothing when everything was claimed elsewhere", () => {
    const { rerender } = renderModal({ streams: [{ streamId: 1n, withdrawable: 5n, asset: ASSET }] });

    rerender(
      <ClaimAllModal
        pools={[]}
        streams={[{ streamId: 1n, withdrawable: 0n, asset: ASSET }]}
        user={USER}
        onClose={vi.fn()}
        preflight={readyPreflight([], [])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));

    expect(queueState.start).not.toHaveBeenCalled();
    expect(screen.getByText(/NOTHING LEFT TO CLAIM/)).toBeInTheDocument();
  });

  it("submits the reviewed work unchanged when nothing moved", () => {
    // Guard against over-correction: recomputing must not drop valid work.
    renderModal({
      pools: [{ lending: LENDING, loanId: 1n, claimable: 100n, asset: ASSET }],
      streams: [{ streamId: 7n, withdrawable: 5n, asset: ASSET }],
    });

    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.start).toHaveBeenCalledTimes(1);
    expect((queueState.start.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it("does not enter review when there was nothing to claim at open", () => {
    renderModal({});
    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));
    expect(
      screen.queryByRole("button", { name: "CONFIRM QUEUE" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/NOTHING LEFT TO CLAIM/)).toBeInTheDocument();
  });

  it("requires an explicit second review before accepting changed grouped work", () => {
    queueState.needsReview = true;
    queueState.rows = [
      {
        tx: {
          kind: "pool-claims",
          lending: LENDING,
          claims: [{ loanId: 1n, claimable: 50n }],
          asset: ASSET,
        },
        status: "needs-review",
      },
    ];
    renderModal({
      pools: [{ lending: LENDING, loanId: 1n, claimable: 50n, asset: ASSET }],
    });

    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));
    fireEvent.click(screen.getByRole("button", { name: "REVIEW CHANGES" }));
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.acceptReview).toHaveBeenCalledTimes(2);
  });
});
