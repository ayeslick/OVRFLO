import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionButton } from "@/components/kit/ActionButton";
import { AddressChip } from "@/components/kit/AddressChip";
import { Amount } from "@/components/kit/Amount";
import { AmountField } from "@/components/kit/AmountField";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { QueueBand } from "@/components/kit/QueueBand";
import { Receipt } from "@/components/kit/Receipt";
import { RollingNumber } from "@/components/kit/RollingNumber";
import { SettlementTrace } from "@/components/kit/SettlementTrace";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { TokenUsdSwitch } from "@/components/kit/TokenUsdSwitch";

describe("kit labels, roles, and state classes", () => {
  it("Shell names the product and peer nav items", () => {
    render(
      <Shell currentNav="borrow" wallet="CONNECT WALLET" status={<StatusLine status="synced" asOf="12:34:56" />}>
        home
      </Shell>,
    );
    expect(screen.getByRole("heading", { name: "OVRFLO" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "BORROW" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "SUPPLY" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ASSETS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RISK" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "POSITIONS" })).not.toBeInTheDocument();
  });

  it("StatusLine distinguishes SYNCED, RECONNECTING, and DEGRADED", () => {
    const { rerender } = render(<StatusLine status="synced" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "synced");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS AS OF 12:34:56");

    rerender(<StatusLine status="reconnecting" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "reconnecting");
    expect(screen.getByRole("status")).toHaveTextContent("RECONNECTING");

    rerender(<StatusLine status="degraded" asOf="12:34:56" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "degraded");
    expect(screen.getByRole("status")).toHaveTextContent("DEGRADED — SHOWING LAST KNOWN");

    rerender(<StatusLine status="unavailable" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "unavailable");
    expect(screen.getByRole("status")).toHaveTextContent("EVENTS UNAVAILABLE");
  });

  it("TokenUsdSwitch disables with USD UNAVAILABLE", () => {
    render(<TokenUsdSwitch mode="usd" tokenLabel="wstETH" usdAvailable={false} onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "USD UNAVAILABLE" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "USD UNAVAILABLE" })).toHaveAttribute(
      "data-state",
      "disabled-unavailable",
    );
  });

  it("Amount keeps the token visible and names USD UNAVAILABLE", () => {
    render(<Amount token="5.00000" symbol="wstETH" usdAvailable={false} mode="usd" />);
    expect(screen.getByText(/5\.00000/)).toBeInTheDocument();
    expect(screen.getByText("USD UNAVAILABLE")).toBeInTheDocument();
  });

  it("ActionButton requires a visible reason when disabled", () => {
    render(
      <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
        CLOSE FROM STREAM
      </ActionButton>,
    );
    expect(screen.getByRole("button", { name: "CLOSE FROM STREAM" })).toBeDisabled();
    expect(screen.getByText("EVENTS STALE — SIGNING DISABLED")).toBeInTheDocument();
  });

  it("Receipt lines stay token-exact", () => {
    render(
      <Receipt
        kind="permission"
        state="current"
        lines={[{ key: "ALLOWANCE", value: "EXACTLY 5.00000 wstETH" }]}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("EXACTLY 5.00000 wstETH")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("SettlementTrace omits skipped stages without renumbering labels", () => {
    render(
      <SettlementTrace
        steps={[
          { id: "amount", label: "AMOUNT", state: "done" },
          { id: "approve", label: "APPROVE wstETH", state: "skipped" },
          { id: "supply", label: "SUPPLY", state: "active" },
        ]}
      />,
    );
    expect(screen.getByText("SETTLEMENT")).toBeInTheDocument();
    expect(screen.getByText("AMOUNT")).toBeInTheDocument();
    expect(screen.getByText("SUPPLY")).toBeInTheDocument();
    expect(screen.queryByText("APPROVE wstETH")).not.toBeInTheDocument();
  });

  it("QueueBand is a meter with token aria-valuetext", () => {
    render(
      <QueueBand
        state="ready"
        aheadFraction={0.6}
        selfFraction={0.4}
        valueText="12.4000 wstETH ahead"
        aheadLabel="AHEAD"
        selfLabel="THIS ORDER"
      />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "12.4000 wstETH ahead");
  });

  it("AmountField marks inline errors and submits on Enter without blocking paste", () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <AmountField
        label="SUPPLY AMOUNT"
        value="0.5"
        unit="wstETH"
        error="BELOW MINIMUM"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText("SUPPLY AMOUNT");
    expect(input).toHaveAttribute("inputMode", "decimal");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();

    const paste = createEvent.paste(input, {
      clipboardData: { getData: () => "1,5" },
    });
    fireEvent(input, paste);
    expect(paste.defaultPrevented).toBe(false);
  });

  it("DisclosureRow uses aria-expanded", () => {
    const onToggle = vi.fn();
    render(
      <DisclosureRow id="fee" label="FEE FROM PROCEEDS" open={false} onToggle={onToggle}>
        body
      </DisclosureRow>,
    );
    expect(screen.getByRole("button", { name: /FEE FROM PROCEEDS/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /FEE FROM PROCEEDS/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("AddressChip recovers the full address via title", () => {
    const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    render(<AddressChip address={address} />);
    expect(screen.getByRole("button", { name: "0x7099…79C8" })).toHaveAttribute(
      "title",
      `Copy wallet address: ${address}`,
    );
  });

  it("static RollingNumber has no timer role", () => {
    render(<RollingNumber value={5n * 10n ** 18n} ticking={false} displayDecimals={2} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
