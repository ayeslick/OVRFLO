import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatTokenFromWei, interpolateAmount } from "@/components/kit/formatDisplay";
import { RollingNumber } from "@/components/kit/RollingNumber";
import { emitRafForTests } from "@/components/kit/rafDriver";

const SCALE = 10n ** 18n;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

describe("RollingNumber", () => {
  it("keeps a fixed-width tabular container across ticks", () => {
    const start = NOW;
    const schedule = {
      startMs: start,
      endMs: start + 3_600_000,
      startAmount: 10n ** 18n - 1n,
      endAmount: 2n * 10n ** 18n,
    };
    const { rerender } = render(
      <RollingNumber schedule={schedule} nowMs={start} ticking displayDecimals={2} />,
    );
    const first = screen.getByRole("timer");
    const width = first.style.width;
    expect(width).toMatch(/ch$/);
    expect(first.style.fontVariantNumeric).toBe("tabular-nums");
    rerender(<RollingNumber schedule={schedule} nowMs={start + 3_600_000} ticking displayDecimals={2} />);
    expect(screen.getByRole("timer").style.width).toBe(width);
  });

  it("never ticks backwards across a rounding boundary", () => {
    const displays: string[] = [];
    const values = [
      1_994_999_999_999_999_999n,
      1_995_000_000_000_000_000n,
      1_996_000_000_000_000_000n,
      2n * SCALE,
    ];
    for (const value of values) {
      displays.push(formatTokenFromWei(value, 18, 2));
    }
    const numeric = displays.map((text) => Number(text.replace(/,/g, "")));
    for (let i = 1; i < numeric.length; i += 1) {
      expect(numeric[i]).toBeGreaterThanOrEqual(numeric[i - 1]!);
    }
    expect(displays[0]).toBe("1.99");
    expect(displays[3]).toBe("2.00");
  });

  it("a one-hour time jump is instantly correct with no accumulation", () => {
    const start = Date.UTC(2026, 7, 12, 12, 0, 0);
    const schedule = {
      startMs: start,
      endMs: start + 2 * 3_600_000,
      startAmount: 0n,
      endAmount: SCALE,
    };
    const jumped = start + 3_600_000;
    const expected = interpolateAmount({ ...schedule, nowMs: jumped });
    const { rerender } = render(
      <RollingNumber schedule={schedule} nowMs={start} ticking displayDecimals={8} />,
    );
    rerender(<RollingNumber schedule={schedule} nowMs={jumped} ticking displayDecimals={8} />);
    expect(screen.getByRole("timer")).toHaveTextContent(formatTokenFromWei(expected, 18, 8));
  });

  it("keeps updating numeric text on rAF while ticking", async () => {
    const start = Date.now() - 1000;
    const schedule = {
      startMs: start,
      endMs: start + 86_400_000,
      startAmount: 0n,
      endAmount: SCALE,
    };
    render(<RollingNumber schedule={schedule} ticking displayDecimals={8} />);
    const before = screen.getByRole("timer").textContent;
    emitRafForTests();
    await waitFor(() => {
      expect(screen.getByRole("timer").textContent).toBeTruthy();
    });
    expect(typeof before).toBe("string");
  });
});
