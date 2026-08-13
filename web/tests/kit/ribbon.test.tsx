import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapitalBand } from "@/components/kit/CapitalBand";
import {
  drawDotRibbon,
  RIBBON_FUTURE,
  RIBBON_GOLD,
  RIBBON_INK,
  RIBBON_POINT_BUDGET,
} from "@/components/kit/drawRibbon";
import { setDevicePixelRatioForTests, setReducedMotionForTests } from "@/components/kit/motion";
import * as rafDriver from "@/components/kit/rafDriver";
import { Ribbon } from "@/components/kit/Ribbon";
import { RollingNumber } from "@/components/kit/RollingNumber";

function mockCanvas() {
  const fillRect = vi.fn();
  const strokeRect = vi.fn();
  const clearRect = vi.fn();
  const setTransform = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect,
    strokeRect,
    clearRect,
    setTransform,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return { fillRect, strokeRect, clearRect, setTransform };
}

describe("Ribbon and CapitalBand", () => {
  beforeEach(() => {
    mockCanvas();
    setReducedMotionForTests(false);
    setDevicePixelRatioForTests(1);
  });

  afterEach(() => {
    setReducedMotionForTests(false);
    setDevicePixelRatioForTests(1);
  });

  it("renders 0%, 100%, and sub-pixel progress as meters with token aria-valuetext", () => {
    const { rerender } = render(
      <Ribbon
        state="edge"
        progress={0}
        valueText="0.00000000 ovrflo"
        originLabel="ORIGIN"
        terminalLabel="END"
        widthPx={360}
      />,
    );
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuetext", "0.00000000 ovrflo");
    expect(meter).toHaveAttribute("data-progress", "0");

    rerender(
      <Ribbon
        state="edge"
        progress={1}
        valueText="1.00000000 ovrflo"
        originLabel="ORIGIN"
        terminalLabel="END"
        widthPx={360}
      />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("data-progress", "1");

    rerender(
      <Ribbon
        state="edge"
        progress={0.001}
        valueText="0.00100000 ovrflo"
        originLabel="ORIGIN"
        terminalLabel="END"
        widthPx={360}
      />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("data-progress", "0.001");
  });

  it("stays inside the point budget at the 360px gate", () => {
    const fillRect = vi.fn();
    const ctx = {
      fillRect,
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const dots = drawDotRibbon(
      ctx,
      360,
      36,
      [
        { fraction: 0.5, color: RIBBON_INK, rows: 3 },
        { fraction: 0.5, color: RIBBON_FUTURE, rows: 3 },
      ],
      { fraction: 0.5, color: RIBBON_GOLD },
    );
    expect(dots).toBeLessThanOrEqual(RIBBON_POINT_BUDGET);
    expect(fillRect.mock.calls.length).toBeLessThanOrEqual(RIBBON_POINT_BUDGET + 8);
  });

  it("redraws the backing store when devicePixelRatio changes", async () => {
    render(
      <Ribbon
        state="edge"
        progress={0.4}
        valueText="0.40 ovrflo"
        originLabel="ORIGIN"
        terminalLabel="END"
        widthPx={200}
        heightPx={40}
      />,
    );
    await waitFor(() => {
      const canvas = screen.getByRole("meter") as HTMLCanvasElement;
      expect(canvas.width).toBe(200);
    });
    setDevicePixelRatioForTests(2);
    await waitFor(() => {
      const canvas = screen.getByRole("meter") as HTMLCanvasElement;
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(80);
    });
  });

  it("stops canvas rAF under reduced motion while RollingNumber text continues", async () => {
    const subscribeSpy = vi.spyOn(rafDriver, "subscribeRaf");
    render(
      <>
        <Ribbon
          state="edge"
          progress={0.3}
          valueText="0.30 ovrflo"
          originLabel="ORIGIN"
          terminalLabel="END"
          widthPx={200}
          startMs={Date.now() - 1000}
          endMs={Date.now() + 86_400_000}
        />
        <RollingNumber
          schedule={{
            startMs: Date.now() - 1000,
            endMs: Date.now() + 86_400_000,
            startAmount: 0n,
            endAmount: 10n ** 18n,
          }}
          ticking
          displayDecimals={4}
        />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("meter")).toHaveAttribute("data-motion", "live"));
    expect(subscribeSpy).toHaveBeenCalled();
    expect(rafDriver.rafListenerCount()).toBeGreaterThan(0);
    expect(screen.getByRole("timer")).toBeInTheDocument();

    const listenersAfterLive = rafDriver.rafListenerCount();
    setReducedMotionForTests(true);
    await waitFor(() => expect(screen.getByRole("meter")).toHaveAttribute("data-motion", "static"));
    expect(rafDriver.rafListenerCount()).toBeLessThan(listenersAfterLive);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    rafDriver.emitRafForTests();
    expect(screen.getByRole("timer").textContent).toBeTruthy();
    subscribeSpy.mockRestore();
  });

  it("CapitalBand resting is a static meter", async () => {
    render(
      <CapitalBand
        state="resting"
        valueText="5.00000 wstETH unfilled"
        widthPx={360}
        segments={[{ id: "u", fraction: 1, kind: "unfilled" }]}
      />,
    );
    await waitFor(() => expect(screen.getByRole("meter")).toHaveAttribute("data-state", "resting"));
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "5.00000 wstETH unfilled");
    expect(screen.getByRole("meter")).toHaveAttribute("data-motion", "static");
  });
});
