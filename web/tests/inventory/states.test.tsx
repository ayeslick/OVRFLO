import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { SURFACE_STATES, SURFACE_STATE_LABEL } from "@/lib/surface-state";
import { SelectMarket } from "@/components/supply/SelectMarket";
import { SelectStream } from "@/components/borrow/SelectStream";
import { Converter } from "@/components/assets/Converter";
import { wrapTrace } from "@/components/assets/trace";
import { stubViewport, TRANSACTING_WIDTHS, UNDERLYING, SYMBOL, SCALE, noop } from "./fixtures";

const TOPOLOGIES = ["watch", "supply", "borrow", "assets"] as const;
const WAD = SCALE;
const ready = (value: bigint) => ({ status: "ready" as const, value });

describe.each(TRANSACTING_WIDTHS)("inventory — 18 surface states at %ipx", (width) => {
  beforeEach(() => stubViewport(width));

  it("one representative LOADING, EMPTY, STALE, PENDING, ERROR per topology", () => {
    for (const topology of TOPOLOGIES) {
      const { unmount } = render(
        <div>
          {SURFACE_STATES.map((state) => (
            <SurfaceState key={state} state={state} topology={topology} />
          ))}
        </div>,
      );
      const nodes = document.querySelectorAll(`[data-topology="${topology}"]`);
      expect(nodes).toHaveLength(8);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.LOADING).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.EMPTY).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.STALE).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.WALLET_PENDING).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.CHAIN_PENDING).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.ERROR).length).toBeGreaterThan(0);
      expect(SURFACE_STATE_LABEL.STALE).not.toBe(SURFACE_STATE_LABEL.LOADING);
      unmount();
    }
  });

  it("topology-native LOADING stays distinct from empty", () => {
    const { unmount: u1 } = render(
      <SelectMarket state="loading" markets={[]} selected={null} onSelect={noop} />,
    );
    expect(screen.getByText("LOADING MARKETS")).toBeInTheDocument();
    expect(screen.queryByText(/No approved active pre-maturity markets/)).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(
      <SelectStream state="loading" streams={[]} selectedId={null} ovrfloSymbol={SYMBOL} onSelect={noop} />,
    );
    expect(screen.getByText("LOADING STREAMS")).toBeInTheDocument();
    expect(screen.queryByText("Borrow needs a stream")).not.toBeInTheDocument();
    u2();

    render(
      <Converter
        direction="wrap"
        onDirection={noop}
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
        walletUnderlying={{ status: "loading" }}
        walletOvrflo={{ status: "loading" }}
        wrapReserve={{ status: "loading" }}
        matured={false}
        amountRaw=""
        amountWei={null}
        onAmount={noop}
        unwrapAvailability="enabled"
        outputState="empty"
        outputLabel=""
        stage="amount"
        steps={wrapTrace({ underlyingSymbol: UNDERLYING, needsApprove: true, ackRequired: false, stage: "amount" })}
        permissionLines={[]}
        permissionState="ghosted"
        actionLines={[]}
        actionState="ghosted"
        connected
      />,
    );
    expect(screen.getAllByText("CHECKING…").length).toBeGreaterThan(0);
    expect(screen.queryByText(`0.00000 ${UNDERLYING}`)).not.toBeInTheDocument();
  });
});

describe("inventory — 18 STALE vs LOADING (signing)", () => {
  it("STALE offers REFRESH; LOADING does not", () => {
    const { rerender } = render(<SurfaceState state="STALE" topology="supply" onRefresh={() => undefined} />);
    expect(screen.getByRole("button", { name: "REFRESH" })).toBeInTheDocument();
    rerender(<SurfaceState state="LOADING" topology="supply" onRefresh={() => undefined} />);
    expect(screen.queryByRole("button", { name: "REFRESH" })).not.toBeInTheDocument();
  });

  it("READY is not EMPTY and not a zeroed meter wall", () => {
    render(
      <Converter
        direction="wrap"
        onDirection={noop}
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
        walletUnderlying={ready(5n * WAD)}
        walletOvrflo={ready(2n * WAD)}
        wrapReserve={ready(3n * WAD)}
        matured={false}
        amountRaw="1"
        amountWei={1n * WAD}
        onAmount={noop}
        unwrapAvailability="enabled"
        outputState="ready"
        outputLabel={`1 ${SYMBOL}`}
        stage="amount"
        steps={wrapTrace({ underlyingSymbol: UNDERLYING, needsApprove: true, ackRequired: false, stage: "amount" })}
        permissionLines={[]}
        permissionState="ghosted"
        actionLines={[]}
        actionState="ghosted"
        connected
      />,
    );
    expect(screen.getByText("OUTPUT")).toBeInTheDocument();
    expect(screen.queryByText("EMPTY")).not.toBeInTheDocument();
  });
});
