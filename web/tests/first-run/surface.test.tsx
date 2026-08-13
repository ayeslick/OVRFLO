import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { Surface } from "@/components/first-run/Surface";
import { Chooser } from "@/components/first-run/Chooser";
import { TEACHING_SENTENCES } from "@/components/first-run/cycleCopy";
import { pendleMarketUrlTemplate } from "@/components/first-run/pendleLink";

const MARKET = getAddress("0xcFD848b9f6fEf552204014ac67901223AD6bf679");
const PT = getAddress("0x9cE6478EF45bB1BAAC69EFd8A3eA0ed110a43042");
const OVR = getAddress("0x1111111111111111111111111111111111111111");
const UND = getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0");

const market = {
  market: MARKET,
  ptToken: PT,
  ovrfloToken: OVR,
  underlying: UND,
  expiryCached: 1_800_000_000n,
};

function renderGuided(
  overrides: Partial<ComponentProps<typeof Surface>> = {},
) {
  const onDismiss = vi.fn();
  const onSelectMarket = vi.fn();
  const view = render(
    <Surface
      markets={[market]}
      selectedMarket={market}
      onSelectMarket={onSelectMarket}
      ovrfloSymbol={null}
      underlyingSymbol={null}
      ptBalance={{ status: "ready", value: 0n }}
      underlyingBalance={{ status: "ready", value: 0n }}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return { onDismiss, onSelectMarket, unmount: view.unmount };
}

describe("guided first run (AE5)", () => {
  it("renders the teaching surface without a demonstration loan or meter wall", () => {
    renderGuided();
    expect(screen.getByText(TEACHING_SENTENCES[0])).toBeInTheDocument();
    expect(document.querySelector('[data-step="get-pt"]')).toHaveTextContent("GET PT");
    expect(screen.getByText("mints the market's ovrflo token")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText(/demonstration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/synthetic/i)).not.toBeInTheDocument();
  });

  it("renders the live symbol when a market is chosen", () => {
    renderGuided({ ovrfloSymbol: "ovrfloWSTETH" });
    expect(screen.getByText("mints ovrfloWSTETH")).toBeInTheDocument();
    expect(screen.getByText("ovrfloWSTETH + stream")).toBeInTheDocument();
  });

  it("links a verified Pendle URL and labels it external", () => {
    renderGuided();
    const link = screen.getByRole("link", { name: /GET PT ON PENDLE/i });
    expect(link).toHaveAttribute("href", pendleMarketUrlTemplate(MARKET));
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent(/external/i);
    expect(screen.getByRole("link", { name: /I ALREADY HOLD PT/i })).toHaveAttribute("href", "/assets");
  });

  it("degrades a rotten Pendle URL to naming the series, not a fake button", () => {
    renderGuided({ pendleConfiguredUrl: "https://example.invalid/markets/nope" });
    expect(screen.queryByRole("link", { name: /GET PT ON PENDLE/i })).not.toBeInTheDocument();
    expect(screen.getByText("GET PT ON PENDLE")).toBeInTheDocument();
    expect(screen.getByText(/no verified external link/i)).toBeInTheDocument();
    expect(document.querySelector('[data-control="UI-FIRST-RUN-INTENT-BORROW"]')).toHaveAttribute(
      "data-state",
      "degraded",
    );
  });

  it("emphasizes deposit when PT balance is ready and keeps the path at zero", () => {
    const { rerender } = render(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol={null}
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "ready", value: 0n }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: /I ALREADY HOLD PT/i })).toHaveAttribute("data-state", "enabled");
    rerender(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol={null}
        ptBalance={{ status: "ready", value: 1n }}
        underlyingBalance={{ status: "ready", value: 0n }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: /I ALREADY HOLD PT/i })).toHaveAttribute(
      "data-state",
      "ready-balance",
    );
  });

  it("shows supply when underlying is nonzero and hides it on a confirmed zero", () => {
    const { rerender } = render(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol="wstETH"
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "ready", value: 5n }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: "SUPPLY wstETH" })).toHaveAttribute("href", "/supply");
    expect(screen.getByRole("link", { name: /GET PT ON PENDLE/i })).toBeInTheDocument();
    rerender(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol="wstETH"
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "ready", value: 0n }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.queryByRole("link", { name: /SUPPLY/ })).not.toBeInTheDocument();
  });

  it("keeps supply visible while the underlying read is loading or unavailable", () => {
    const { rerender } = render(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol={null}
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "loading" }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText("CHECKING UNDERLYING…")).toBeInTheDocument();
    rerender(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol={null}
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "unavailable" }}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText("UNDERLYING BALANCE UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText(/holds none/i)).not.toBeInTheDocument();
  });

  it("persists dismiss through SKIP FOR NOW and yields a plain chooser", () => {
    const { onDismiss, unmount } = renderGuided();
    fireEvent.click(screen.getByRole("button", { name: "SKIP FOR NOW" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    unmount();
    render(<Chooser />);
    expect(screen.getByRole("link", { name: "BORROW" })).toHaveAttribute("href", "/borrow");
    expect(screen.getByRole("link", { name: "SUPPLY" })).toHaveAttribute("href", "/supply");
    expect(screen.getByRole("link", { name: "ASSETS" })).toHaveAttribute("href", "/assets");
    expect(screen.queryByText(TEACHING_SENTENCES[0])).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
