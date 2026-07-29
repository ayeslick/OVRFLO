import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const LENDING = "0x00000000000000000000000000000000000000aa" as Address;

const queueState = {
  start: vi.fn(),
  resume: vi.fn(),
  rows: [] as unknown[],
  statusOf: () => "pending" as const,
  running: false,
  paused: false,
  failed: false,
  error: null,
  inFlight: false,
  done: false,
};

vi.mock("@/hooks/useTxQueue", () => ({ useTxQueue: () => queueState }));
vi.mock("@/hooks/useFocusTrap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/hooks/useEscapeKey", () => ({ useEscapeKey: () => {} }));

import { ClaimAllModal } from "@/components/ClaimAllModal";

// R41/M-6: the plan used to be frozen at modal open via useState initialiser,
// and CONFIRM QUEUE submitted that snapshot. RESUME always re-planned from live
// props — the first confirm did not, which is the asymmetry the finding names.
// Between opening and confirming, a stream can be claimed elsewhere or a pool
// share drawn down, and the frozen plan would queue transactions already spent.
function renderModal(props: {
  pools?: { lending: Address; loanId: bigint; claimable: bigint }[];
  streams?: { streamId: bigint; withdrawable: bigint }[];
}) {
  const { rerender, ...rest } = render(
    <ClaimAllModal pools={props.pools ?? []} streams={props.streams ?? []} user={USER} onClose={vi.fn()} />,
  );
  return { rerender, ...rest };
}

describe("ClaimAllModal — plan freshness (R41)", () => {
  beforeEach(() => {
    queueState.start = vi.fn();
    queueState.resume = vi.fn();
    queueState.done = false;
    queueState.failed = false;
    queueState.paused = false;
    queueState.inFlight = false;
  });

  it("submits a plan recomputed at confirm time, not the one shown at open", () => {
    const streams = [{ streamId: 1n, withdrawable: 5n }];
    const { rerender } = renderModal({ streams });

    // The stream is claimed elsewhere while the modal sits open, and a second
    // one appears. The props update; the frozen review plan does not.
    rerender(
      <ClaimAllModal
        pools={[]}
        streams={[
          { streamId: 1n, withdrawable: 0n },
          { streamId: 2n, withdrawable: 9n },
        ]}
        user={USER}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.start).toHaveBeenCalledTimes(1);
    const submitted = queueState.start.mock.calls[0][0] as { streamId?: bigint }[];
    // Only the still-claimable stream, and the newly claimable one.
    expect(submitted.map((tx) => tx.streamId)).toEqual([2n]);
  });

  it("says so rather than queueing nothing when everything was claimed elsewhere", () => {
    const { rerender } = renderModal({ streams: [{ streamId: 1n, withdrawable: 5n }] });

    rerender(
      <ClaimAllModal pools={[]} streams={[{ streamId: 1n, withdrawable: 0n }]} user={USER} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.start).not.toHaveBeenCalled();
    expect(screen.getByText(/NOTHING LEFT TO CLAIM/)).toBeInTheDocument();
  });

  it("submits the reviewed work unchanged when nothing moved", () => {
    // Guard against over-correction: recomputing must not drop valid work.
    renderModal({
      pools: [{ lending: LENDING, loanId: 1n, claimable: 100n }],
      streams: [{ streamId: 7n, withdrawable: 5n }],
    });

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));

    expect(queueState.start).toHaveBeenCalledTimes(1);
    expect((queueState.start.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it("disables confirm when there was nothing to claim at open", () => {
    renderModal({});
    expect(screen.getByRole("button", { name: "CONFIRM QUEUE" })).toBeDisabled();
  });
});
