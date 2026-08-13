import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { SURFACE_STATES, SURFACE_STATE_LABEL, type SurfaceStateKind } from "@/lib/surface-state";

const TOPOLOGIES = ["watch", "supply", "borrow", "assets"] as const;

describe("state matrix — one topology per route", () => {
  it("renders all eight states with distinct labeled UI on each route topology", () => {
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
      const labels = [...nodes].map((node) => node.getAttribute("data-surface-state"));
      expect(labels).toEqual([...SURFACE_STATES]);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.LOADING).length).toBeGreaterThan(0);
      expect(screen.getAllByText(SURFACE_STATE_LABEL.STALE).length).toBeGreaterThan(0);
      expect(screen.getByText(SURFACE_STATE_LABEL.STALE).textContent).not.toBe(
        SURFACE_STATE_LABEL.LOADING,
      );
      unmount();
    }
  });

  it("gives STALE a refresh affordance that LOADING does not have", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <SurfaceState state="STALE" topology="supply" onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<SurfaceState state={"LOADING" as SurfaceStateKind} topology="supply" onRefresh={onRefresh} />);
    expect(screen.queryByRole("button", { name: "REFRESH" })).not.toBeInTheDocument();
  });
});
