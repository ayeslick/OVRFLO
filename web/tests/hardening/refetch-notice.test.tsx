import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import {
  isBackgroundRefetchFailure,
  setBackgroundRefetchFailed,
} from "@/lib/refetch-notice";

describe("freshness degraded and one refetch notice", () => {
  afterEach(() => {
    setBackgroundRefetchFailed(false);
  });

  it("wires DEGRADED — SHOWING LAST KNOWN from the status line", () => {
    render(<StatusLine status="degraded" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "degraded");
    expect(screen.getByRole("status")).toHaveTextContent("DEGRADED — SHOWING LAST KNOWN");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS AS OF 12:34:56");
  });

  it("classifies a failed background refetch as last-known, not a first load", () => {
    expect(
      isBackgroundRefetchFailure({
        state: { status: "error", dataUpdatedAt: 1, fetchStatus: "idle" },
      }),
    ).toBe(true);
    expect(
      isBackgroundRefetchFailure({
        state: { status: "error", dataUpdatedAt: 0, fetchStatus: "idle" },
      }),
    ).toBe(false);
  });

  it("surfaces one global notice rather than per-hook toasts", () => {
    setBackgroundRefetchFailed(true);
    render(
      <Shell currentNav="borrow" wallet="CONNECT" status={<StatusLine status="degraded" />}>
        body
      </Shell>,
    );
    const notices = screen.getAllByText("BACKGROUND REFRESH FAILED — SHOWING LAST KNOWN");
    expect(notices).toHaveLength(1);
    expect(document.querySelectorAll('[data-ui="UI-SHELL-REFETCH-NOTICE"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    expect(screen.queryByText("BACKGROUND REFRESH FAILED — SHOWING LAST KNOWN")).not.toBeInTheDocument();
  });
});
