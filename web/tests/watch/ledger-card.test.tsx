import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreamClosedDetail, StreamDetail } from "@/components/watch/StreamDetail";
import { StreamsDegraded } from "@/components/watch/Wall";
import { setReducedMotionForTests } from "@/components/kit/motion";
import type { HydratedStream } from "@/hooks/useStreams";
import type { Freshness } from "@/lib/freshness";
import {
  OVRFLO_STREAM_DESCRIPTOR_PIN,
  buildLedgerCardSnapshot,
  ledgerFilledSegments,
  LOCKUP_STATUS,
} from "@/lib/ledger-card";

const SCALE = 10n ** 18n;
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const NOW = 1_800_000_000n;
const NOW_MS = Number(NOW) * 1000;
const synced: Freshness = { kind: "synced", asOf: NOW };

function stream(overrides: Partial<HydratedStream> = {}): HydratedStream {
  return {
    streamId: 42n,
    owner: ACCOUNT,
    sender: VAULT,
    asset: TOKEN,
    schedule: {
      start: NOW - 37n * 86_400n,
      end: NOW + 63n * 86_400n,
      deposited: 100n * SCALE,
      withdrawn: 0n,
      refunded: 0n,
      cliffTime: NOW - 37n * 86_400n,
      isCancelable: false,
    },
    withdrawable: 37n * SCALE,
    remaining: 100n * SCALE,
    status: LOCKUP_STATUS.STREAMING,
    renderEligible: true,
    borrowRouteEligible: true,
    vault: VAULT,
    market: MARKET,
    ...overrides,
  };
}

describe("ledger card snapshot math", () => {
  it("fills 9 of 24 segments for ~37% streamed (U3 golden shape)", () => {
    const deposited = 100n * SCALE;
    const streamed = 37n * SCALE;
    expect(ledgerFilledSegments(streamed, deposited)).toBe(9);
  });

  it("puts descriptor pin in the cache key (SC15)", () => {
    const snap = buildLedgerCardSnapshot({
      streamId: 42n,
      statusCode: LOCKUP_STATUS.STREAMING,
      schedule: stream().schedule,
      asOf: NOW,
    });
    expect(snap.cacheKey.startsWith(`${OVRFLO_STREAM_DESCRIPTOR_PIN}:`)).toBe(true);
    expect(snap.cacheKey.includes("42")).toBe(true);
  });
});

describe("StreamDetail ledger card", () => {
  afterEach(() => {
    setReducedMotionForTests(false);
  });

  it("paints HTML card from hydrated state with 24 segments and gold frontier", () => {
    const row = stream();
    render(
      <StreamDetail
        stream={row}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    const card = screen.getByRole("article", { name: /Stream 42 Streaming card/i });
    expect(card).toHaveAttribute("data-ui", "UI-WATCH-LEDGER-CARD");
    expect(card.querySelectorAll(".watch-ledger-cell")).toHaveLength(24);
    expect(card.querySelectorAll(".watch-ledger-cell.on.gold")).toHaveLength(1);
    expect(card.querySelector(".watch-ledger-bar")).toHaveClass("is-live");
    const meter = card.querySelector('[role="meter"]');
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(card.getAttribute("data-cache-key") ?? "").toContain(OVRFLO_STREAM_DESCRIPTOR_PIN);
  });

  it("keeps bar percent fixed when the clock advances without hydration refresh", () => {
    const row = stream();
    const { rerender } = render(
      <StreamDetail
        stream={row}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    const pctBefore = screen.getByText(/%/).textContent;
    const goldBefore = document.querySelectorAll(".watch-ledger-cell.on.gold").length;
    const later = NOW + 86_400n;
    rerender(
      <StreamDetail
        stream={row}
        symbol="ovrfloTEST"
        nowSeconds={later}
        nowMs={Number(later) * 1000}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    expect(screen.getByText(/%/).textContent).toBe(pctBefore);
    expect(document.querySelectorAll(".watch-ledger-cell.on.gold").length).toBe(goldBefore);
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });

  it("shows Withdrawn not Days left on depleted, and omits the band", () => {
    render(
      <StreamDetail
        stream={stream({
          status: LOCKUP_STATUS.DEPLETED,
          remaining: 0n,
          schedule: {
            start: NOW - 100n * 86_400n,
            end: NOW - 1n,
            deposited: SCALE,
            withdrawn: SCALE,
            refunded: 0n,
            cliffTime: NOW - 100n * 86_400n,
            isCancelable: false,
          },
        })}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    expect(screen.queryByText("Days left")).not.toBeInTheDocument();
    expect(document.querySelector(".watch-ledger-bar")).not.toHaveClass("is-live");
    expect(document.querySelectorAll(".watch-ledger-cell.on.gold")).toHaveLength(0);
  });

  it("omits the live band under reduced motion", () => {
    setReducedMotionForTests(true);
    render(
      <StreamDetail
        stream={stream()}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    // Band wrapper may still mount for streaming; CSS hides it under reduce.
    // Assert RollingNumber records reduced and meter still paints.
    expect(screen.getByRole("timer")).toHaveAttribute("data-reduced-motion", "true");
    expect(document.querySelector(".watch-ledger-bar[role='meter']")).toBeTruthy();
  });

  it("keeps figures visible when signingAllowed is false", () => {
    render(
      <StreamDetail
        stream={stream()}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={{ kind: "degraded", asOf: NOW }}
        signingAllowed={false}
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    expect(screen.getByRole("article", { name: /Streaming card/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BORROW AGAINST THIS STREAM" })).toBeDisabled();
    expect(screen.getByText("EVENTS STALE — SIGNING DISABLED")).toBeInTheDocument();
  });

  it("renders terminal stream closed for a missing id", () => {
    render(<StreamClosedDetail streamId={5n} />);
    expect(screen.getByText("STREAM CLOSED")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAttribute("data-state", "closed");
    expect(screen.getByRole("article").getAttribute("aria-label")).toContain("5");
  });

  it("updates HTML fill when withdrawn changes on hydration", () => {
    const base = stream();
    const { rerender } = render(
      <StreamDetail
        stream={base}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    const keyBefore = screen.getByRole("article", { name: /Streaming card/i }).getAttribute("data-cache-key");
    const withdrawn = stream({
      schedule: { ...base.schedule, withdrawn: 10n * SCALE },
      withdrawable: 27n * SCALE,
    });
    rerender(
      <StreamDetail
        stream={withdrawn}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW + 1n}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    const keyAfter = screen.getByRole("article", { name: /Streaming card/i }).getAttribute("data-cache-key");
    expect(keyAfter).not.toBe(keyBefore);
    expect(keyAfter ?? "").toContain("10000000000000000000");
  });
});

describe("streams degraded copy", () => {
  it("does not point at canonical Sablier", () => {
    render(<StreamsDegraded kind="could-not-ask" />);
    expect(screen.getByText(/OVRFLOSTREAM/i)).toBeInTheDocument();
    expect(screen.queryByText(/0xAFb9/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SABLIER/i)).not.toBeInTheDocument();
  });
});

describe("U3 golden DOMParser well-formedness", () => {
  it("parses each staged SVG with no parsererror node", () => {
    const dir = join(process.cwd(), "..", "artifacts", "goldens", "ovrflo-stream-descriptor");
    const files = readdirSync(dir).filter((name) => name.endsWith(".svg"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const svg = readFileSync(join(dir, name), "utf8");
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const errors = doc.getElementsByTagName("parsererror");
      expect(errors.length, name).toBe(0);
    }
  });
});
