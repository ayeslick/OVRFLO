import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AmountStep } from "@/components/supply/AmountStep";
import { MarketContext } from "@/components/supply/MarketContext";
import { QueuePlace } from "@/components/supply/QueuePlace";
import { RateStep } from "@/components/supply/RateStep";
import { ReviewHandoff } from "@/components/supply/ReviewHandoff";
import { SelectMarket } from "@/components/supply/SelectMarket";
import type { SupplySnapshot } from "@/components/supply/helpers";
import { shapeLadder, tickWindow } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";
import {
  EXPIRY,
  LENDING,
  MARKET,
  noop,
  SCALE,
  stubViewport,
  TRANSACTING_WIDTHS,
  UNDERLYING,
} from "./fixtures";

const ETHER = SCALE;
const FROZEN: SupplySnapshot = {
  amount: 2n * ETHER,
  aprBps: 500,
  ahead: ETHER,
  aprMinBps: 400,
  aprMaxBps: 800,
  spacing: 100,
};

const noopWrite = {
  onAcknowledge: noop,
  onApprove: noop,
  onSupply: noop,
  onRelatch: noop,
  onViewPosition: noop,
};

describe.each(TRANSACTING_WIDTHS)("inventory — supply topology at %ipx", (width) => {
  beforeEach(() => stubViewport(width));

  it("9 SUPPLY.SELECT_MARKET — live ticks and depth; never TVL; loading ≠ empty", () => {
    const { rerender } = render(
      <SelectMarket state="loading" markets={[]} selected={null} onSelect={noop} />,
    );
    expect(screen.getByText("LOADING MARKETS")).toHaveAttribute("data-state", "loading");
    rerender(<SelectMarket state="empty" markets={[]} selected={null} onSelect={noop} />);
    expect(screen.getByText(/No approved active pre-maturity markets/)).toBeInTheDocument();
    rerender(
      <SelectMarket
        state="ready"
        markets={[
          {
            market: MARKET,
            underlyingSymbol: UNDERLYING,
            expiry: EXPIRY,
            liveTicks: 3,
            bestDepth: 12n * ETHER,
          },
        ]}
        selected={null}
        onSelect={noop}
      />,
    );
    expect(screen.getByText(/3 LIVE TICKS/)).toBeInTheDocument();
    expect(screen.getByText(/BEST DEPTH/)).toBeInTheDocument();
    expect(screen.queryByText(/TVL/i)).not.toBeInTheDocument();
  });

  it("10 SUPPLY.ENTER_AMOUNT + SELECT_RATE — MAX, unit/minimum, queue place, CHANGE MARKET", () => {
    const model = shapeLadder([
      { aprBps: 400, availableUnits: 1_000_000n },
      { aprBps: 500, availableUnits: 2_000_000n },
      { aprBps: 600, availableUnits: 3_000_000n },
    ]);
    const window = tickWindow(model, 500, { aprMin: 400, aprMax: 800 });
    render(
      <>
        <MarketContext underlyingSymbol={UNDERLYING} expiry={EXPIRY} onChange={noop} />
        <AmountStep
          value="2"
          unit={UNDERLYING}
          minLiquidity={MIN_LIQUIDITY_AMOUNT}
          onChange={noop}
          onMax={noop}
        />
        <RateStep
          windowState="ready"
          window={window}
          selectedAprBps={500}
          underlyingSymbol={UNDERLYING}
          allRatesOpen={false}
          ladder={model}
          onSelect={noop}
          onStep={noop}
          onOpenAllRates={noop}
          onCloseAllRates={noop}
        />
        <QueuePlace ahead={ETHER} amount={2n * ETHER} unit={UNDERLYING} state="ready" />
      </>,
    );
    expect(screen.getByRole("button", { name: "← CHANGE MARKET" })).toBeInTheDocument();
    expect(screen.getByText(/MINIMUM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MAX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ALL RATES" })).toBeInTheDocument();
    expect(screen.getByText("AHEAD")).toBeInTheDocument();
    expect(screen.getByText("THIS ORDER")).toBeInTheDocument();
  });

  it("11 SUPPLY.REVIEW — earnings-begin-only-when-filled; frozen-review action receipt", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="review"
        underlyingSymbol={UNDERLYING}
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved={false}
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        {...noopWrite}
      />,
    );
    expect(screen.getByText(/EARNINGS BEGIN ONLY WHEN FILLED/)).toBeInTheDocument();
    expect(screen.getByText("REVIEW SUPPLY")).toBeInTheDocument();
    expect(screen.getByText("SETTLEMENT")).toBeInTheDocument();
    expect(document.querySelector('[data-kind="action"]')).toHaveAttribute("data-state", "frozen-review");
    expect(screen.queryByText(/APY/i)).not.toBeInTheDocument();
  });

  it("12 SUPPLY.APPROVE — exact allowance; CONFIRMED reserved for the action", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="approve"
        underlyingSymbol={UNDERLYING}
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved={false}
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        {...noopWrite}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("MATCH EXACT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPROVE wstETH" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUPPLY" })).not.toBeInTheDocument();
  });

  it("13 SUPPLY.SIGN — SUPPLY armed after approval; no APPROVE button", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol={UNDERLYING}
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        {...noopWrite}
      />,
    );
    expect(screen.getByRole("button", { name: "SUPPLY" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "APPROVE wstETH" })).not.toBeInTheDocument();
  });

  it("14 SUPPLY.CONFIRMED — position identity; VIEW POSITION; filled zero", () => {
    render(
      <ReviewHandoff
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="confirmed"
        underlyingSymbol={UNDERLYING}
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        positionId={7n}
        {...noopWrite}
      />,
    );
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIEW POSITION" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUPPLY" })).not.toBeInTheDocument();
    expect(document.querySelector('[data-kind="action"]')).toHaveAttribute("data-state", "confirmed");
  });
});
