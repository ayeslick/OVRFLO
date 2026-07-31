import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { ClaimAllModal } from "@/components/ClaimAllModal";
import type { ClaimAllPreflightEvaluation } from "@/lib/claim-all";

const user = "0x0000000000000000000000000000000000000a11" as Address;
const asset = "0x00000000000000000000000000000000000000cc" as Address;

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
  outcome: "idle" as const,
};

vi.mock("@/hooks/useTxQueue", () => ({ useTxQueue: () => queueState }));
vi.mock("@/hooks/useFocusTrap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/hooks/useEscapeKey", () => ({ useEscapeKey: () => {} }));

function blockedPreflight(): ClaimAllPreflightEvaluation {
  return {
    status: "blocked",
    canReview: false,
    reason: "verifier-unavailable",
    candidateIds: [],
    progress: [
      { source: "markets", status: "complete", retryable: false, message: "2 candidates" },
      { source: "streams", status: "complete", retryable: false, message: "1 candidate" },
      { source: "hydration", status: "complete", retryable: false, message: "3 candidates" },
      { source: "verifier", status: "failed", retryable: true, message: "Verifier unavailable" },
    ],
  };
}

function readyPreflight(): ClaimAllPreflightEvaluation {
  return {
    ...blockedPreflight(),
    status: "ready",
    canReview: true,
    reason: null,
    candidateIds: ["stream:7"],
    progress: blockedPreflight().progress.map((row) => ({
      ...row,
      status: "complete",
      retryable: false,
    })),
  };
}

describe("Claim All preflight", () => {
  beforeEach(() => {
    queueState.start = vi.fn();
    queueState.resume = vi.fn();
  });

  it("shows source progress, keeps Close/Cancel available, and retries only the failed scope", () => {
    const onClose = vi.fn();
    const onRetryPreflight = vi.fn();
    render(
      <ClaimAllModal
        pools={[]}
        streams={[{ streamId: 7n, withdrawable: 5n, asset }]}
        user={user}
        onClose={onClose}
        preflight={blockedPreflight()}
        onRetryPreflight={onRetryPreflight}
      />,
    );

    expect(screen.getByText("MARKETS — COMPLETE")).toBeInTheDocument();
    expect(screen.getByText("VERIFIER — FAILED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CONFIRM QUEUE" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RETRY VERIFIER" }));
    expect(onRetryPreflight).toHaveBeenCalledExactlyOnceWith("verifier");
    fireEvent.click(screen.getByRole("button", { name: "CANCEL PREFLIGHT" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("does not expose batch review when the verifier is missing, while preserving individual recovery copy", () => {
    render(
      <ClaimAllModal
        pools={[]}
        streams={[{ streamId: 7n, withdrawable: 5n, asset }]}
        user={user}
        onClose={vi.fn()}
        preflight={blockedPreflight()}
      />,
    );

    expect(screen.getByText(/INDEPENDENT VERIFIER UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/INDIVIDUAL VERIFIED CLAIMS AND KNOWN-ID RECOVERY REMAIN AVAILABLE/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "REVIEW CLAIMS" })).not.toBeInTheDocument();
  });

  it("enters review only after preflight is complete and agreed", () => {
    render(
      <ClaimAllModal
        pools={[]}
        streams={[{ streamId: 7n, withdrawable: 5n, asset }]}
        user={user}
        onClose={vi.fn()}
        preflight={readyPreflight()}
      />,
    );

    expect(screen.queryByRole("button", { name: "CONFIRM QUEUE" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "REVIEW CLAIMS" }));
    expect(screen.getByRole("button", { name: "CONFIRM QUEUE" })).toBeEnabled();
  });

  it("does not let a corroborated candidate set authorize different displayed rows", () => {
    render(
      <ClaimAllModal
        pools={[]}
        streams={[{ streamId: 8n, withdrawable: 5n, asset }]}
        user={user}
        onClose={vi.fn()}
        preflight={readyPreflight()}
      />,
    );

    expect(
      screen.getByText(/DISPLAYED CLAIMS NO LONGER MATCH THE CORROBORATED PREFLIGHT/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "REVIEW CLAIMS" }),
    ).not.toBeInTheDocument();
  });
});
