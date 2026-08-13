import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamCreate } from "@/components/assets/StreamCreate";
import { depositCapCopy, streamTrace, wrapTrace } from "@/components/assets/trace";
import type { Address } from "viem";

const market = "0x00000000000000000000000000000000000000a1" as Address;
const WAD = 10n ** 18n;

describe("skip-without-renumber", () => {
  it("omits wrap approve when allowance already covers and keeps WRAP unnumbered", () => {
    const steps = wrapTrace({
      underlyingSymbol: "wstETH",
      needsApprove: false,
      ackRequired: false,
      stage: "wrap",
    });
    const shown = steps.filter((step) => step.state !== "skipped").map((step) => step.label);
    expect(shown).toEqual(["AMOUNT", "WRAP", "SETTLED"]);
  });

  it("omits both stream approvals without leaving a numbered hole", () => {
    const shown = streamTrace({
      needsPt: false,
      needsFee: false,
      ackRequired: false,
      stage: "deposit",
    })
      .filter((step) => step.state !== "skipped")
      .map((step) => step.label);
    expect(shown).toEqual(["MARKET", "PT AMOUNT", "DEPOSIT", "SETTLED"]);
  });

  it("keeps APPROVE FEE when only PT is already covered", () => {
    const shown = streamTrace({
      needsPt: false,
      needsFee: true,
      ackRequired: false,
      stage: "approve-fee",
    })
      .filter((step) => step.state !== "skipped")
      .map((step) => step.label);
    expect(shown).toEqual(["MARKET", "PT AMOUNT", "APPROVE FEE", "DEPOSIT", "SETTLED"]);
  });
});

describe("deposit cap copy", () => {
  it("names the cap when exceeded", () => {
    expect(
      depositCapCopy({
        capLimit: 100n * WAD,
        capRemaining: 10n * WAD,
        capExceeded: true,
        capReached: false,
      }),
    ).toBe("DEPOSIT CAP 100.00 PT EXCEEDED — REMAINING 10.00 PT");
  });

  it("names the cap when reached", () => {
    expect(
      depositCapCopy({
        capLimit: 50n * WAD,
        capRemaining: 0n,
        capExceeded: false,
        capReached: true,
      }),
    ).toBe("DEPOSIT CAP 50.00 PT REACHED — REMAINING 0.00 PT");
  });
});

describe("StreamCreate flow", () => {
  it("walks market → PT amount → review with fee buffer lines and borrow handoff", () => {
    const onSelect = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <StreamCreate
        stage="market"
        marketStatus="ready"
        markets={[
          {
            id: market,
            vault: "0x00000000000000000000000000000000000000b2" as Address,
            underlyingSymbol: "wstETH",
            ovrfloSymbol: "ovrfloWSTETH",
            expiry: 1_900_000_000n,
          },
        ]}
        selectedMarket={null}
        onSelectMarket={onSelect}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw=""
        onAmount={vi.fn()}
        ptBalanceLabel="20.00 PT"
        onContinue={onContinue}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "market" })}
        permissionLines={[]}
        permissionState="skipped"
        actionLines={[]}
        actionState="ghosted"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /wstETH/ }));
    expect(onSelect).toHaveBeenCalledWith(market);
    expect(screen.getByText(/MINTS ovrfloWSTETH/)).toBeInTheDocument();

    rerender(
      <StreamCreate
        stage="amount"
        marketStatus="ready"
        markets={[]}
        selectedMarket={market}
        onSelectMarket={onSelect}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw="10"
        onAmount={vi.fn()}
        ptBalanceLabel="20.00 PT"
        onContinue={onContinue}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "amount" })}
        permissionLines={[]}
        permissionState="skipped"
        actionLines={[]}
        actionState="ghosted"
        capCopy="DEPOSIT CAP 100.00 PT — REMAINING 80.00 PT"
      />,
    );
    expect(screen.getByLabelText("PT")).toHaveValue("10");
    expect(screen.getByText(/DEPOSIT CAP 100.00 PT/)).toBeInTheDocument();

    rerender(
      <StreamCreate
        stage="review"
        marketStatus="ready"
        markets={[]}
        selectedMarket={market}
        onSelectMarket={onSelect}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw="10"
        onAmount={vi.fn()}
        ptBalanceLabel="20.00 PT"
        onContinue={onContinue}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "review" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={1n * WAD}
        boundedApproval={(102n * WAD) / 100n}
        maturity={1_900_000_000n}
        capCopy="DEPOSIT CAP 100.00 PT — REMAINING 80.00 PT"
        permissionLines={[
          { key: "CURRENT FEE", value: "1.00 wstETH" },
          { key: "BOUNDED APPROVAL", value: "1.02 wstETH" },
        ]}
        permissionState="ghosted"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="frozen-review"
      />,
    );
    expect(screen.getByText("PT IN")).toBeInTheDocument();
    expect(screen.getByText("MINTED TO WALLET")).toBeInTheDocument();
    expect(screen.getByText("STREAM AMOUNT")).toBeInTheDocument();
    expect(screen.getAllByText("CURRENT FEE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BOUNDED APPROVAL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.02 wstETH").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "REVIEW DEPOSIT" })).toBeInTheDocument();

    rerender(
      <StreamCreate
        stage="confirmed"
        marketStatus="ready"
        markets={[]}
        selectedMarket={market}
        onSelectMarket={onSelect}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw="10"
        onAmount={vi.fn()}
        ptBalanceLabel="20.00 PT"
        onContinue={onContinue}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "confirmed" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={1n * WAD}
        boundedApproval={(102n * WAD) / 100n}
        streamId={42n}
        borrowHref="/borrow/?stream=42"
        viewStreamHref="/?lens=streams&stream=42"
        permissionLines={[]}
        permissionState="skipped"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="confirmed"
      />,
    );
    expect(screen.getByRole("link", { name: "BORROW AGAINST THIS STREAM" })).toHaveAttribute(
      "href",
      "/borrow/?stream=42",
    );
    expect(screen.getByRole("link", { name: "VIEW STREAM" })).toHaveAttribute(
      "href",
      "/?lens=streams&stream=42",
    );
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("skips both checkpoints in the visible SETTLEMENT trace", () => {
    render(
      <StreamCreate
        stage="sign"
        marketStatus="ready"
        markets={[]}
        selectedMarket={market}
        onSelectMarket={vi.fn()}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw="10"
        onAmount={vi.fn()}
        ptBalanceLabel="20.00 PT"
        onContinue={vi.fn()}
        steps={streamTrace({ needsPt: false, needsFee: false, ackRequired: false, stage: "deposit" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={0n}
        boundedApproval={0n}
        permissionLines={[]}
        permissionState="skipped"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="current"
        onDeposit={vi.fn()}
      />,
    );
    expect(screen.getByText("SETTLEMENT")).toBeInTheDocument();
    expect(screen.getByText("MARKET")).toBeInTheDocument();
    expect(screen.getByText("PT AMOUNT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DEPOSIT" })).toBeInTheDocument();
    expect(screen.queryByText("APPROVE PT")).not.toBeInTheDocument();
    expect(screen.queryByText("APPROVE FEE")).not.toBeInTheDocument();
  });

  it("names the deposit cap when exceeded on the amount step", () => {
    render(
      <StreamCreate
        stage="amount"
        marketStatus="ready"
        markets={[]}
        selectedMarket={market}
        onSelectMarket={vi.fn()}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        amountRaw="90"
        onAmount={vi.fn()}
        amountError="DEPOSIT CAP 100.00 PT EXCEEDED — REMAINING 10.00 PT"
        ptBalanceLabel="200.00 PT"
        onContinue={vi.fn()}
        continueDisabled
        continueReason="DEPOSIT CAP 100.00 PT EXCEEDED — REMAINING 10.00 PT"
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "amount" })}
        capCopy="DEPOSIT CAP 100.00 PT EXCEEDED — REMAINING 10.00 PT"
        permissionLines={[]}
        permissionState="skipped"
        actionLines={[]}
        actionState="ghosted"
      />,
    );
    expect(screen.getAllByText(/DEPOSIT CAP 100.00 PT EXCEEDED/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "CONTINUE" })).toBeDisabled();
  });
});
