import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { SelectMarket, MarketUnavailable } from "@/components/supply/SelectMarket";
import { AmountStep } from "@/components/supply/AmountStep";
import { MarketContext } from "@/components/supply/MarketContext";
import { RateStep } from "@/components/supply/RateStep";
import { QueuePlace } from "@/components/supply/QueuePlace";
import { SupplyFacts } from "@/components/supply/Facts";
import { ReviewHandoff } from "@/components/supply/ReviewHandoff";
import { shapeLadder, tickWindow } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, UNIT } from "@/lib/lending-math";
import { parseDecimalInput } from "@/lib/parse";
import { formatTokenAmount } from "@/lib/format";
import {
  amountFieldError,
  shownTraceLabels,
  snapshotSupply,
  supplyDrift,
  supplyTrace,
  tickNoLongerValid,
  weiToAmountInput,
  type SupplySnapshot,
} from "@/components/supply/helpers";

const MARKET = "0x0000000000000000000000000000000000000d44" as Address;
const LENDING = "0x0000000000000000000000000000000000000e55" as Address;
const ETHER = 10n ** 18n;
const EXPIRY = 1_900_000_000n;

const FROZEN: SupplySnapshot = {
  amount: 2n * ETHER,
  aprBps: 500,
  ahead: ETHER,
  aprMinBps: 400,
  aprMaxBps: 800,
  spacing: 100,
};

describe("amount field", () => {
  it("accepts exact MIN_LIQUIDITY_AMOUNT and round-trips MAX", () => {
    const minRaw = weiToAmountInput(MIN_LIQUIDITY_AMOUNT);
    const minParsed = parseDecimalInput(minRaw);
    expect(minParsed.ok).toBe(true);
    if (minParsed.ok) expect(minParsed.value).toBe(MIN_LIQUIDITY_AMOUNT);
    expect(amountFieldError(minRaw, minParsed, 10n * ETHER)).toBeUndefined();

    const maxRaw = weiToAmountInput(5n * ETHER);
    const maxParsed = parseDecimalInput(maxRaw);
    expect(maxParsed.ok).toBe(true);
    if (maxParsed.ok) expect(maxParsed.value).toBe(5n * ETHER);
    expect(amountFieldError(maxRaw, maxParsed, 5n * ETHER)).toBeUndefined();
  });

  it("rejects below-minimum, unaligned, and over-balance amounts", () => {
    const tiny = parseDecimalInput("0.0001");
    expect(amountFieldError("0.0001", tiny, 10n * ETHER)).toMatch(/minimum/i);

    const unaligned = { ok: true as const, value: MIN_LIQUIDITY_AMOUNT + 1n };
    expect(amountFieldError("x", unaligned, 10n * ETHER, MIN_LIQUIDITY_AMOUNT, UNIT, "wstETH")).toMatch(
      /UNIT/i,
    );

    const over = parseDecimalInput("9");
    expect(amountFieldError("9", over, ETHER)).toBe("INSUFFICIENT BALANCE");
  });

  it("shows truthful MAX and inline unit/minimum on the field", () => {
    const maxed: string[] = [];
    render(
      <AmountStep
        value=""
        unit="wstETH"
        minLiquidity={MIN_LIQUIDITY_AMOUNT}
        onChange={() => undefined}
        onMax={() => maxed.push("max")}
      />,
    );
    expect(screen.getByText(/MINIMUM/)).toBeInTheDocument();
    expect(screen.getByText(/UNIT-ALIGNED/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(maxed).toEqual(["max"]);
  });

  it("disables MAX while balance is unread", () => {
    render(
      <AmountStep value="" unit="wstETH" maxDisabled onChange={() => undefined} onMax={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
  });
});

describe("SelectMarket", () => {
  it("keeps loading, empty, and unavailable distinct", () => {
    const { rerender } = render(
      <SelectMarket state="loading" markets={[]} selected={null} onSelect={() => undefined} />,
    );
    expect(screen.getByText("LOADING MARKETS")).toHaveAttribute("data-state", "loading");
    rerender(<SelectMarket state="unavailable" markets={[]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByText("MARKET REGISTRY UNAVAILABLE")).toHaveAttribute("data-state", "unavailable");
    rerender(<SelectMarket state="empty" markets={[]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByText(/No approved active pre-maturity markets/)).toBeInTheDocument();
  });

  it("lists markets with live ticks and best depth, never TVL", () => {
    const chosen: Address[] = [];
    render(
      <SelectMarket
        state="ready"
        markets={[
          {
            market: MARKET,
            underlyingSymbol: "wstETH",
            expiry: EXPIRY,
            liveTicks: 3,
            bestDepth: 12n * ETHER,
          },
        ]}
        selected={null}
        onSelect={(id) => chosen.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /wstETH/ }));
    expect(chosen).toEqual([MARKET]);
    expect(screen.getByText(/3 LIVE TICKS/)).toBeInTheDocument();
    expect(screen.getByText(/BEST DEPTH/)).toBeInTheDocument();
    expect(screen.queryByText(/TVL/i)).not.toBeInTheDocument();
  });

  it("names a matured market without retargeting", () => {
    render(<MarketUnavailable name="wstETH" reason="matured-or-inactive" />);
    expect(screen.getByText(/wstETH can no longer take supply/)).toBeInTheDocument();
    expect(screen.queryByText(/picked a better rate/i)).not.toBeInTheDocument();
  });
});

describe("Rate window and queue band", () => {
  it("steps one tick and disables paddles with reason at bounds", () => {
    const model = shapeLadder([
      { aprBps: 400, availableUnits: 1_000_000n },
      { aprBps: 500, availableUnits: 2_000_000n },
      { aprBps: 600, availableUnits: 3_000_000n },
    ]);
    const window = tickWindow(model, 400, { aprMin: 400, aprMax: 600 });
    render(
      <RateStep
        windowState="ready"
        window={window}
        selectedAprBps={400}
        underlyingSymbol="wstETH"
        allRatesOpen={false}
        ladder={model}
        onSelect={() => undefined}
        onStep={() => undefined}
        onOpenAllRates={() => undefined}
        onCloseAllRates={() => undefined}
      />,
    );
    const lower = screen.getByRole("button", { name: "Lower APR" });
    expect(lower).toBeDisabled();
    expect(lower).toHaveTextContent("LOWEST CONFIGURED APR");
    expect(screen.getByRole("button", { name: "ALL RATES" })).toBeInTheDocument();
    expect(screen.getAllByText(/AHEAD/).length).toBeGreaterThan(0);
  });

  it("shows the position's literal place on the queue band", () => {
    render(<QueuePlace ahead={3n * ETHER} amount={1n * ETHER} unit="wstETH" state="ready" />);
    const meter = document.querySelector('[role="meter"]');
    expect(meter).toHaveAttribute("aria-valuetext", expect.stringMatching(/ahead/i));
    expect(screen.getByText("AHEAD")).toBeInTheDocument();
    expect(screen.getByText("THIS ORDER")).toBeInTheDocument();
    expect(screen.getByText(/withdrawable until filled/i)).toBeInTheDocument();
  });
});

describe("Facts and review", () => {
  it("states earnings begin only when filled", () => {
    render(
      <SupplyFacts amount={2n * ETHER} aprBps={500} expiry={EXPIRY} ahead={ETHER} underlyingSymbol="wstETH" />,
    );
    expect(screen.getByText(/EARNINGS BEGIN ONLY WHEN FILLED/)).toBeInTheDocument();
    expect(screen.queryByText(/APY/i)).not.toBeInTheDocument();
  });

  it("shows exact-allowance PERMISSION RECEIPT and ghosted ACTION RECEIPT", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="approve"
        underlyingSymbol="wstETH"
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved={false}
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onSupply={() => undefined}
        onRelatch={() => undefined}
        onViewPosition={() => undefined}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("ALLOWANCE")).toBeInTheDocument();
    expect(screen.getAllByText(formatTokenAmount(FROZEN.amount, "wstETH")).length).toBeGreaterThan(0);
    expect(screen.getByText("MATCH EXACT")).toBeInTheDocument();
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
    expect(document.querySelector('[data-kind="action"]')).toHaveAttribute("data-state", "ghosted");
    expect(screen.getByRole("button", { name: "APPROVE wstETH" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUPPLY" })).not.toBeInTheDocument();
  });

  it("skips the approval checkpoint without renumbering when allowance covers", () => {
    const shown = shownTraceLabels(
      supplyTrace({
        underlyingSymbol: "wstETH",
        needsApprove: false,
        ackRequired: false,
        checkpoint: "sign",
      }),
    );
    expect(shown).toEqual(["AMOUNT", "APR", "SUPPLY", "SETTLED"]);
    expect(shown).not.toContain("APPROVE wstETH");
  });

  it("stays at the approval checkpoint when the signature is rejected", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="approve"
        underlyingSymbol="wstETH"
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved={false}
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        errorCopy="SIGNATURE REJECTED — SELECTIONS KEPT"
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onSupply={() => undefined}
        onRelatch={() => undefined}
        onViewPosition={() => undefined}
      />,
    );
    expect(screen.getByText("SIGNATURE REJECTED — SELECTIONS KEPT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPROVE wstETH" })).toBeInTheDocument();
    expect(screen.getAllByText("5.00%").length).toBeGreaterThan(0);
  });

  it("decodes a revert to copy plus one recovery action", () => {
    const recovered: string[] = [];
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol="wstETH"
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        errorCopy="This APR is outside the market bounds or not on a supported step."
        recoveryLabel="Pick a different rate"
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onSupply={() => undefined}
        onRelatch={() => undefined}
        onRecovery={() => recovered.push("rate")}
        onViewPosition={() => undefined}
      />,
    );
    expect(screen.getByText(/outside the market bounds/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick a different rate" }));
    expect(recovered).toEqual(["rate"]);
  });

  it("freezes signing on quote drift and does not silently move the APR", () => {
    const live = { ...FROZEN, ahead: 4n * ETHER };
    expect(supplyDrift(FROZEN, live)).toBe(true);
    expect(tickNoLongerValid(500, { aprMinBps: 600, aprMaxBps: 800, spacing: 100 })).toBe(true);
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={live}
        drifted
        checkpoint="sign"
        underlyingSymbol="wstETH"
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onSupply={() => undefined}
        onRelatch={() => undefined}
        onViewPosition={() => undefined}
      />,
    );
    expect(screen.getAllByText("ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "SUPPLY" })).toBeDisabled();
    expect(screen.queryByText(/picked a better rate/i)).not.toBeInTheDocument();
  });

  it("puts position identity on the confirmed receipt and offers VIEW POSITION", () => {
    const viewed: bigint[] = [];
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="confirmed"
        underlyingSymbol="wstETH"
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        positionId={7n}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onSupply={() => undefined}
        onRelatch={() => undefined}
        onViewPosition={(id) => viewed.push(id)}
      />,
    );
    expect(screen.getByText("#7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "VIEW POSITION" }));
    expect(viewed).toEqual([7n]);
  });

  it("keeps CHANGE MARKET on the amount step", () => {
    render(
      <MarketContext underlyingSymbol="wstETH" expiry={EXPIRY} onChange={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "← CHANGE MARKET" })).toBeInTheDocument();
  });
});

describe("supplyTrace skip-without-renumber", () => {
  it("keeps AMOUNT and APR labels when approve is omitted", () => {
    expect(
      shownTraceLabels(
        supplyTrace({
          underlyingSymbol: "wstETH",
          needsApprove: false,
          ackRequired: false,
          checkpoint: "confirmed",
        }),
      ),
    ).toEqual(["AMOUNT", "APR", "SUPPLY", "SETTLED"]);
  });

  it("latches a snapshot that round-trips", () => {
    expect(snapshotSupply(FROZEN)).toEqual(FROZEN);
  });
});
