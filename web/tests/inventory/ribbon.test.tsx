import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Ribbon } from "@/components/kit/Ribbon";
import { StatusLine } from "@/components/kit/StatusLine";
import { mockCanvas } from "./fixtures";

describe("inventory — B ribbon state set + C degraded status", () => {
  beforeEach(() => mockCanvas());

  it("B recorded / edge / future / inert / degraded stay distinguishable", () => {
    const states = ["recorded", "edge", "future", "inert", "degraded"] as const;
    for (const state of states) {
      const { unmount } = render(
        <Ribbon
          state={state}
          progress={state === "future" ? 0.2 : 0.55}
          valueText="1.00000000 ovrfloTEST"
          originLabel="ORIGIN"
          terminalLabel="08 JAN 2027"
          widthPx={360}
        />,
      );
      const meter = screen.getByRole("meter");
      expect(meter).toHaveAttribute("data-state", state);
      expect(meter).toHaveAttribute("aria-valuetext", "1.00000000 ovrfloTEST");
      expect(screen.getByText("08 JAN 2027")).toBeInTheDocument();
      unmount();
    }
  });

  it("B inert ribbon has zero live motion class on the wrap", () => {
    render(
      <Ribbon
        state="inert"
        progress={0}
        valueText="5.00000 wstETH unfilled"
        originLabel="ORIGIN"
        terminalLabel="TERMINAL"
        widthPx={360}
      />,
    );
    expect(document.querySelector(".kit-ribbon-wrap")).toHaveAttribute("data-state", "inert");
    expect(screen.getByRole("meter")).toHaveAttribute("data-state", "inert");
  });

  it("C UI-SHELL-STATUS degraded vs synced vs unavailable stay distinct", () => {
    const { rerender } = render(<StatusLine status="synced" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "synced");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS AS OF 12:34:56");

    rerender(<StatusLine status="degraded" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "degraded");
    expect(screen.getByRole("status")).toHaveTextContent("DEGRADED — SHOWING LAST KNOWN");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS AS OF 12:34:56");
    expect(screen.getByRole("status")).not.toHaveTextContent("SCHEDULES TICK LIVE");

    rerender(<StatusLine status="unavailable" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "unavailable");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS UNAVAILABLE");
    expect(screen.getByRole("status")).not.toHaveTextContent("SCHEDULES TICK LIVE");
  });
});
