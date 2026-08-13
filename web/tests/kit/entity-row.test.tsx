import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityRow } from "@/components/kit/EntityRow";
import { RollingNumber } from "@/components/kit/RollingNumber";

describe("EntityRow", () => {
  it("resting row renders zero animated nodes", () => {
    const { container } = render(
      <EntityRow
        state="resting"
        identity="SUPPLY #041"
        stateLine="NOTHING ACCRUES UNTIL MATCHED · 2ND IN QUEUE · WITHDRAWABLE"
        decisive="RESTING"
        miniband={{ filled: 0 }}
      />,
    );
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(container.querySelector("[data-motion='live']")).toBeNull();
    expect(container.querySelector("[data-ticking='true']")).toBeNull();
    expect(container.querySelector("[data-kind='inert']")).not.toBeNull();
  });

  it("partial row may host a ticking decisive number", () => {
    render(
      <EntityRow
        state="partial"
        identity="SUPPLY #026"
        stateLine="EARNING · FILLED 3.10 / 5.00 @ 5.00%"
        decisive={<RollingNumber value={12n * 10n ** 16n} ticking displayDecimals={6} />}
        miniband={{ filled: 0.62 }}
      />,
    );
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "partial");
  });
});
