import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Wall, visibleLensTabs } from "@/components/watch/Wall";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { HydratedStream } from "@/hooks/useStreams";
import type { StreamSchedule } from "@/lib/payoff";
import { entryBook } from "@/lib/watch-entry";

const SCALE = 10n ** 18n;
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const NOW = 1_800_000_000n;

function restingPosition(): LenderPositionRow {
  return {
    id: 41n,
    lending: ACCOUNT,
    lender: ACCOUNT,
    market: MARKET,
    aprBps: 500,
    availableLiquidity: 5n * SCALE,
    intervalStart: 0n,
    intervalEnd: 0n,
    pairs: [],
    pairsTruncated: false,
  };
}

function filledPosition(): LenderPositionRow {
  return {
    id: 26n,
    lending: ACCOUNT,
    lender: ACCOUNT,
    market: MARKET,
    aprBps: 500,
    availableLiquidity: 19n * 10n ** 17n,
    intervalStart: 0n,
    intervalEnd: 31n * 10n ** 17n,
    pairs: [{ loanId: 1n, contribution: 31n * 10n ** 17n, claimable: 12n * 10n ** 16n }],
    pairsTruncated: false,
  };
}

function loan(overrides: Partial<BorrowerLoanRow> = {}): BorrowerLoanRow {
  return {
    id: 12n,
    lending: ACCOUNT,
    market: MARKET,
    borrower: ACCOUNT,
    streamId: 440n,
    obligation: 2n * SCALE,
    drawn: SCALE,
    repaid: 0n,
    closed: false,
    outstanding: SCALE,
    ...overrides,
  };
}

const schedule: StreamSchedule = {
  start: NOW - 30n * 86_400n,
  end: NOW + 150n * 86_400n,
  deposited: 2n * SCALE,
  withdrawn: 0n,
  refunded: 0n,
};

describe("watch wall", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("hides a confirmed-zero lens and defaults dual-role to supplied", () => {
    const tabs = visibleLensTabs({
      positions: entryBook("ready", 1),
      loans: entryBook("ready", 1),
      streams: entryBook("ready", 0),
    });
    expect(tabs.find((tab) => tab.id === "streams")?.visible).toBe(false);
    const { rerender } = render(
      <Wall
        tabs={tabs}
        lens="supplied"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[loan()]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    expect(screen.getByRole("tab", { name: "SUPPLIED" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "STREAMS" })).not.toBeInTheDocument();
    rerender(
      <Wall
        tabs={tabs}
        lens="borrowed"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[loan()]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    expect(screen.getByRole("tab", { name: "BORROWED" })).toBeInTheDocument();
  });

  it("keeps pending and unavailable lenses visible", () => {
    const tabs = visibleLensTabs({
      positions: entryBook("loading", 0),
      loans: entryBook("unavailable", 0),
      streams: entryBook("unavailable", 0),
    });
    expect(tabs.every((tab) => tab.visible)).toBe(true);
  });

  it("renders a resting supply row with zero animated nodes over three ticks (AE2)", () => {
    vi.useFakeTimers();
    const { container } = render(
      <div data-width="1280" style={{ width: 1280 }}>
        <Wall
          tabs={visibleLensTabs({
            positions: entryBook("ready", 1),
            loans: entryBook("ready", 0),
            streams: entryBook("ready", 0),
          })}
          lens="supplied"
          onSelectLens={() => undefined}
          positions={[restingPosition()]}
          loans={[]}
          streams={[]}
          pledgedByStream={new Map()}
          loanStreams={new Map()}
          nowSeconds={NOW}
          nowMs={Number(NOW) * 1000}
          lastReadAt={NOW}
          selection={{ kind: "none" }}
          onSelect={() => undefined}
          streamsDegraded={null}
        />
      </div>,
    );
    const row = screen.getByRole("button", { name: /SUPPLY #41/ });
    expect(row).toHaveAttribute("data-state", "resting");
    expect(row).toHaveTextContent("NOTHING ACCRUES UNTIL MATCHED");
    vi.advanceTimersByTime(3000);
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(container.querySelector("[data-ticking='true']")).toBeNull();
    expect(container.querySelector("[data-kind='inert']")).not.toBeNull();
    vi.useRealTimers();
  });

  it("leads a between-visits fill on the state line and draws the new band (AE3)", () => {
    const { container } = render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 1),
          loans: entryBook("ready", 0),
          streams: entryBook("ready", 0),
        })}
        lens="supplied"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    const row = screen.getByRole("button", { name: /SUPPLY #26/ });
    expect(row).toHaveAttribute("data-state", "partial");
    expect(row.textContent ?? "").toMatch(/^[\s\S]*FILLED/);
    expect(container.querySelector("[data-kind='live']")).not.toBeNull();
  });

  it("marks a covered loan close-ready (AE4)", () => {
    const covered = loan({ id: 8n, outstanding: SCALE / 1000n });
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 0),
          loans: entryBook("ready", 1),
          streams: entryBook("ready", 0),
        })}
        lens="borrowed"
        onSelectLens={() => undefined}
        positions={[]}
        loans={[covered]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={
          new Map([
            [
              covered.streamId.toString(),
              { withdrawable: SCALE, schedule },
            ],
          ])
        }
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    const row = screen.getByRole("button", { name: /LOAN #8/ });
    expect(row).toHaveAttribute("data-state", "close-ready");
    expect(row).toHaveTextContent("COVERED");
  });

  it("keeps closed loans SETTLED on Borrowed after active loans", () => {
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 0),
          loans: entryBook("ready", 2),
          streams: entryBook("ready", 0),
        })}
        lens="borrowed"
        onSelectLens={() => undefined}
        positions={[]}
        loans={[
          loan({ id: 12n }),
          loan({ id: 3n, closed: true, outstanding: 0n, streamId: 441n }),
        ]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    const rows = screen.getAllByRole("button");
    expect(rows[0]).toHaveTextContent("LOAN #12");
    expect(rows[1]).toHaveTextContent("LOAN #3");
    expect(rows[1]).toHaveAttribute("data-state", "settled");
    expect(rows[1]).toHaveTextContent("SETTLED");
    expect(rows[1]).toHaveTextContent("STREAM #441 GONE");
  });

  it("names a residual NFT as returned on a settled loan", () => {
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 0),
          loans: entryBook("ready", 1),
          streams: entryBook("ready", 0),
        })}
        lens="borrowed"
        onSelectLens={() => undefined}
        positions={[]}
        loans={[loan({ id: 3n, closed: true, outstanding: 0n, streamId: 441n })]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={
          new Map([
            [
              "441",
              {
                streamId: 441n,
                withdrawable: 0n,
                schedule,
              },
            ],
          ])
        }
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    expect(screen.getByRole("button", { name: /LOAN #3/ })).toHaveTextContent("RETURNED STREAM #441");
  });

  it("renders the same resting row at 360px without motion", () => {
    const { container } = render(
      <div data-width="360" style={{ width: 360 }}>
        <Wall
          tabs={visibleLensTabs({
            positions: entryBook("ready", 1),
            loans: entryBook("ready", 0),
            streams: entryBook("ready", 0),
          })}
          lens="supplied"
          onSelectLens={() => undefined}
          positions={[restingPosition()]}
          loans={[]}
          streams={[]}
          pledgedByStream={new Map()}
          loanStreams={new Map()}
          nowSeconds={NOW}
          nowMs={Number(NOW) * 1000}
          lastReadAt={NOW}
          selection={{ kind: "none" }}
          onSelect={() => undefined}
          streamsDegraded={null}
        />
      </div>,
    );
    expect(container.querySelector("[data-width='360']")).not.toBeNull();
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "resting");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("does not invent an attention strip", () => {
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 1),
          loans: entryBook("ready", 0),
          streams: entryBook("ready", 0),
        })}
        lens="supplied"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
      />,
    );
    expect(screen.queryByText(/NOW/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEXT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CLAIM ALL/)).not.toBeInTheDocument();
  });
});

describe("streams degraded copy", () => {
  it("states discovery is unavailable and never emptiness", () => {
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 0),
          loans: entryBook("ready", 0),
          streams: entryBook("unavailable", 0),
        })}
        lens="streams"
        onSelectLens={() => undefined}
        positions={[]}
        loans={[]}
        streams={[] as HydratedStream[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded="could-not-ask"
      />,
    );
    expect(screen.getByText(/STREAM DISCOVERY IS UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/UNAFFECTED/)).toBeInTheDocument();
    expect(screen.getByText(/OVRFLOSTREAM/i)).toBeInTheDocument();
    expect(screen.queryByText(/0xAFb9/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you hold no streams/i)).not.toBeInTheDocument();
  });

  it("keeps last-known stream rows under the degraded caption", () => {
    render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 0),
          loans: entryBook("ready", 0),
          streams: entryBook("unavailable", 1),
        })}
        lens="streams"
        onSelectLens={() => undefined}
        positions={[]}
        loans={[]}
        streams={[
          {
            streamId: 5n,
            owner: ACCOUNT,
            sender: ACCOUNT,
            asset: MARKET,
            schedule: {
              start: NOW - 10n,
              end: NOW + 80n,
              deposited: SCALE,
              withdrawn: 0n,
              refunded: 0n,
              cliffTime: NOW - 10n,
              isCancelable: false,
            },
            withdrawable: 1n,
            remaining: SCALE,
            status: 1,
            renderEligible: true,
            borrowRouteEligible: true,
            vault: ACCOUNT,
            market: MARKET,
          },
        ]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded="could-not-ask"
        panelStatus="ready"
      />,
    );
    expect(screen.getByText(/STREAM DISCOVERY IS UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /STREAM #5/ })).toBeInTheDocument();
  });
});

describe("LOAD MORE", () => {
  it("is last in the tabpanel, disabled while fetching, and keeps the control mounted", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 1),
          loans: entryBook("ready", 0),
          streams: entryBook("ready", 0),
        })}
        lens="supplied"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
        pager={{ hasNextPage: true, isFetchingNextPage: false, fetchNextPage: onLoadMore }}
      />,
    );
    const panel = document.getElementById("lens-panel-supplied");
    const button = screen.getByRole("button", { name: "LOAD MORE" });
    expect(button).toHaveAttribute("data-ui", "UI-WATCH-LOAD-MORE");
    expect(button).not.toBeDisabled();
    expect(panel?.lastElementChild?.querySelector("[data-ui='UI-WATCH-LOAD-MORE']")).not.toBeNull();
    button.focus();
    expect(button).toHaveFocus();
    rerender(
      <Wall
        tabs={visibleLensTabs({
          positions: entryBook("ready", 1),
          loans: entryBook("ready", 0),
          streams: entryBook("ready", 0),
        })}
        lens="supplied"
        onSelectLens={() => undefined}
        positions={[filledPosition()]}
        loans={[]}
        streams={[]}
        pledgedByStream={new Map()}
        loanStreams={new Map()}
        nowSeconds={NOW}
        nowMs={Number(NOW) * 1000}
        lastReadAt={NOW}
        selection={{ kind: "none" }}
        onSelect={() => undefined}
        streamsDegraded={null}
        pager={{ hasNextPage: true, isFetchingNextPage: true, fetchNextPage: onLoadMore }}
      />,
    );
    const fetching = screen.getByRole("button", { name: "LOAD MORE" });
    expect(fetching).toBeDisabled();
    expect(fetching).toHaveFocus();
    expect(screen.getByText("LOADING MORE")).toBeInTheDocument();
  });
});
