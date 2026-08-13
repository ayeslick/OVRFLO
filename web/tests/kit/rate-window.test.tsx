import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RateWindow } from "@/components/kit/RateWindow";

const TICKS = [
  { id: "min", aprLabel: "4.00%", hint: "LOW" },
  { id: "mid", aprLabel: "5.00%", hint: "12.4000 AVAILABLE" },
  { id: "max", aprLabel: "6.00%", hint: "HIGH" },
];

describe("RateWindow", () => {
  it("disables the lower paddle with a visible reason at aprMin", () => {
    render(
      <RateWindow state="ready" ticks={TICKS} selectedId="min" atMin atMax={false} />,
    );
    const lower = screen.getByRole("button", { name: "Lower APR" });
    expect(lower).toBeDisabled();
    expect(lower).toHaveTextContent("LOWEST CONFIGURED APR");
    expect(screen.getByRole("button", { name: "Higher APR" })).toBeEnabled();
  });

  it("disables the higher paddle with a visible reason at aprMax", () => {
    render(
      <RateWindow state="ready" ticks={TICKS} selectedId="max" atMin={false} atMax />,
    );
    const higher = screen.getByRole("button", { name: "Higher APR" });
    expect(higher).toBeDisabled();
    expect(higher).toHaveTextContent("HIGHEST CONFIGURED APR");
    expect(screen.getByRole("button", { name: "Lower APR" })).toBeEnabled();
  });

  it("renders loading, empty, and unavailable as distinct copy", () => {
    const { rerender } = render(
      <RateWindow state="loading" ticks={[]} atMin={false} atMax={false} />,
    );
    expect(screen.getByText("LOADING RATES")).toHaveAttribute("data-state", "loading");
    rerender(<RateWindow state="empty" ticks={[]} atMin={false} atMax={false} />);
    expect(screen.getByText("NO LIQUIDITY POSTED AT ANY RATE")).toHaveAttribute("data-state", "empty");
    rerender(<RateWindow state="unavailable" ticks={[]} atMin={false} atMax={false} />);
    expect(screen.getByText("RATES UNAVAILABLE")).toHaveAttribute("data-state", "unavailable");
  });
});
