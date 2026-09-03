import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddressChip } from "@/components/kit/AddressChip";
import { AmountField } from "@/components/kit/AmountField";
import { DefaultHub } from "@/components/kit/DefaultHub";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { EntityRow } from "@/components/kit/EntityRow";
import { RateWindow } from "@/components/kit/RateWindow";
import { Shell } from "@/components/kit/Shell";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { ReviewHandoff } from "@/components/borrow/ReviewHandoff";
import { presentQuote, snapshotQuote } from "@/components/borrow/quote";
import { MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";
import { coverDate } from "@/lib/payoff";
import { namedSurfaceSpec } from "@/lib/named-surface-state";
import { YEAR_SECONDS } from "@/lib/lending-math";
import type { Hex } from "viem";
import { stubViewport } from "../inventory/fixtures";

const WEB_ROOT = process.cwd();
const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ETHER = 10n ** 18n;
const NOW = 1_700_000_000n;
const QUOTE = presentQuote({
  preview: {
    emptyTick: false,
    actualBorrow: 4n * ETHER,
    feeAmount: (4n * ETHER * 40n) / 10_000n,
    obligation: 5n * ETHER,
    block: { N: 1n, H: `0x${"11".repeat(32)}` as Hex },
  },
  target: 4n * ETHER,
  cap: 10n * ETHER,
  depth: 12n * ETHER,
  aprBps: 500,
  streamRemaining: 10n * ETHER,
  minLiquidity: MIN_LIQUIDITY_AMOUNT,
});
const COVER = coverDate(
  { start: NOW, end: NOW + YEAR_SECONDS, deposited: 10n * ETHER, withdrawn: 0n, refunded: 0n },
  QUOTE.obligation,
  NOW,
);
const noopReview = {
  onAcknowledge: () => undefined,
  onApprove: () => undefined,
  onBorrow: () => undefined,
  onRelatch: () => undefined,
  onViewLoan: () => undefined,
};

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll("h1, h2, h3")].map((node) => {
    const level = Number(node.tagName.slice(1));
    return `${level}:${node.textContent?.trim() ?? ""}`;
  });
}

describe("CS4-U6 responsive access", () => {
  it("desktop and mobile captures keep the cool canvas, cards, and single compact surface", () => {
    const css = readFileSync(join(WEB_ROOT, "components/kit/kit.css"), "utf8");
    const globals = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
    expect(globals).toContain("--canvas: #F6F8FC");
    expect(globals).toContain("--primary: #1769E0");
    expect(globals).toContain("--radius-card: 16px");
    expect(css).toContain("background: var(--canvas)");
    expect(css).toContain("background: var(--surface)");
    expect(css).toContain("box-shadow: var(--shadow-card)");
    expect(css).toMatch(/\.kit-card[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.kit-entity-row[\s\S]*min-height:\s*64px/);
    expect(css).toMatch(/\.kit-action[\s\S]*min-height:\s*44px/);
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toMatch(/\.kit-nav\s*\{\s*display:\s*none;/);
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('[data-disclosure="advanced"]');
    expect(css).not.toMatch(/letter-spacing:\s*0\.1em/);
    stubViewport(360);
    render(
      <Shell currentNav="create" wallet={<AddressChip address={ADDRESS} />}>
        <DefaultHub welcome="Choose a position type" />
      </Shell>,
    );
    expect(document.querySelector(".default-hub-types")).not.toBeNull();
    expect(document.querySelector("[data-ui='UI-SHELL-MENU']")).not.toBeNull();
  });

  it("axe-shaped roles hold on create, hub, waiting, completed, and error", () => {
    const { container, rerender } = render(
      <Shell currentNav="create" wallet={<AddressChip address={ADDRESS} />}>
        <DefaultHub welcome="Choose a position type" />
      </Shell>,
    );
    expect(headings(container)[0]).toBe("1:OVRFLO");
    expect(headings(container)).toContain("2:Choose a position type");
    expect(container.querySelectorAll("[aria-hidden='true'][data-identity]").length).toBeGreaterThan(0);

    rerender(
      <Shell currentNav="home" wallet={<AddressChip address={ADDRESS} />}>
        <SurfaceState state="ERROR" topology="watch">
          <p>A read failed.</p>
        </SurfaceState>
      </Shell>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-surface-state", "ERROR");

    rerender(
      <SurfaceState state="READY" topology="watch">
        <p data-named-state="waiting-for-liquidity">{namedSurfaceSpec("waiting-for-liquidity").copy}</p>
        <p data-named-state="completed-position">{namedSurfaceSpec("completed-position").copy}</p>
      </SurfaceState>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(namedSurfaceSpec("waiting-for-liquidity").copy)).toBeInTheDocument();
    expect(screen.getByText(namedSurfaceSpec("completed-position").copy)).toBeInTheDocument();
  });

  it("keyboard operates cards, radios, disclosures, menus, rows, and actions with visible focus", () => {
    const css = readFileSync(join(WEB_ROOT, "components/kit/kit.css"), "utf8");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid var(--focus)");
    render(
      <Shell currentNav="create" wallet="CONNECT WALLET">
        <DefaultHub welcome="Choose a position type" />
        <DisclosureRow id="fee" label="FEE FROM PROCEEDS" open={false} onToggle={() => undefined} />
        <RateWindow
          state="ready"
          ticks={[
            { id: "500", aprLabel: "5.00%", hint: "12 AVAILABLE" },
            { id: "525", aprLabel: "5.25%", hint: "7 AVAILABLE" },
          ]}
          selectedId="500"
          atMin={false}
          atMax={false}
        />
        <EntityRow
          state="repaying"
          identity="LOAN #012"
          stateLine="STREAM REPAYING"
          decisive="1.24"
        />
      </Shell>,
    );
    expect(screen.getByRole("link", { name: /Self-Repaying Loan/ })).not.toHaveAttribute("tabIndex", "-1");
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radios[1]!);
    expect(screen.getByRole("button", { name: /FEE FROM PROCEEDS/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /LOAN #012/ })).toBeEnabled();
    const menu = document.querySelector("[data-ui='UI-SHELL-MENU'] summary");
    expect(menu).not.toBeNull();
  });

  it("associates and announces field errors", () => {
    render(
      <AmountField
        id="supply-amount"
        label="SUPPLY AMOUNT"
        value="0.5"
        unit="wstETH"
        error="BELOW MINIMUM"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText("SUPPLY AMOUNT");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "supply-amount-error");
    expect(screen.getByRole("alert")).toHaveAttribute("id", "supply-amount-error");
  });

  it("announces quote refresh and tx checkpoints without moving focus", () => {
    const frozen = snapshotQuote(QUOTE);
    const { rerender } = render(
      <button type="button">KEEP FOCUS</button>,
    );
    screen.getByRole("button", { name: "KEEP FOCUS" }).focus();
    rerender(
      <>
        <button type="button">KEEP FOCUS</button>
        <ReviewHandoff
          quote={QUOTE}
          frozen={frozen}
          drifted
          checkpoint="sign"
          underlyingSymbol="wstETH"
          ovrfloSymbol="ovrfloWSTETH"
          aprBps={500}
          streamId={441n}
          operator="0x0000000000000000000000000000000000000e55"
          cover={COVER}
          repayCurrent={COVER}
          repayNext={{ status: "covered", at: NOW }}
          acknowledged
          streamApproved
          approveBusy={false}
          borrowBusy={false}
          {...noopReview}
        />
      </>,
    );
    expect(document.activeElement).toHaveTextContent("KEEP FOCUS");
    expect(document.querySelector("[data-ui='UI-REVIEW-LIVE']")).toHaveTextContent(
      namedSurfaceSpec("quote-refreshing").copy,
    );

    rerender(
      <>
        <button type="button">KEEP FOCUS</button>
        <ReviewHandoff
          quote={QUOTE}
          frozen={frozen}
          drifted={false}
          checkpoint="pending"
          underlyingSymbol="wstETH"
          ovrfloSymbol="ovrfloWSTETH"
          aprBps={500}
          streamId={441n}
          operator="0x0000000000000000000000000000000000000e55"
          cover={COVER}
          repayCurrent={COVER}
          repayNext={{ status: "covered", at: NOW }}
          acknowledged
          streamApproved
          approveBusy={false}
          borrowBusy={false}
          {...noopReview}
        />
      </>,
    );
    expect(document.activeElement).toHaveTextContent("KEEP FOCUS");
    expect(document.querySelector("[data-ui='UI-REVIEW-LIVE']")).toHaveTextContent(
      namedSurfaceSpec("transaction-pending").copy,
    );
  });

  it("keeps the full wallet label on title when the chip truncates", () => {
    render(<AddressChip address={ADDRESS} />);
    const chip = screen.getByRole("button", { name: "0x7099…79C8" });
    expect(chip).toHaveAttribute("title", `Copy wallet address: ${ADDRESS}`);
    expect(chip).toHaveAccessibleDescription(`Copy wallet address: ${ADDRESS}`);
  });

  it("hides decorative medallions from the accessibility tree", () => {
    render(<DefaultHub welcome="Choose a position type" />);
    const medallions = document.querySelectorAll(".kit-medallion");
    expect(medallions.length).toBe(2);
    for (const node of medallions) {
      expect(node).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("keeps Advanced on the shared tokens and exposes the mode switch at both widths", () => {
    stubViewport(1280);
    const { unmount } = render(
      <Shell currentNav="home" wallet="CONNECT WALLET">
        <DefaultHub welcome="Choose a position type" />
      </Shell>,
    );
    const account = document.querySelector('[data-ui="UI-SHELL-MODE"][data-location="account"]');
    expect(account).toHaveTextContent("Go to Advanced");
    fireEvent.click(account as HTMLElement);
    expect(document.querySelector("[data-ui='UI-SHELL']")).toHaveAttribute("data-disclosure", "advanced");
    expect(account).toHaveTextContent("Return to Default");
    expect(document.querySelector("[data-ui='UI-SHELL']")?.getAttribute("style")).toBeNull();
    unmount();

    stubViewport(360);
    render(
      <Shell currentNav="home" wallet="CONNECT WALLET">
        body
      </Shell>,
    );
    const menu = document.querySelector("[data-ui='UI-SHELL-MENU']");
    expect(within(menu as HTMLElement).getByRole("button", { name: "Return to Default" })).toBeInTheDocument();
  });
});
