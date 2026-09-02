import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DefaultHub } from "@/components/kit/DefaultHub";
import { Shell } from "@/components/kit/Shell";
import { getDisclosure, resetDisclosure, setDisclosure } from "@/lib/disclosure";

const WEB_ROOT = process.cwd();

function desktopNav() {
  const nav = document.querySelector('[data-ui="UI-SHELL-NAV"]');
  if (!nav) throw new Error("UI-SHELL-NAV missing");
  return within(nav as HTMLElement);
}

function accountMode() {
  const button = document.querySelector('[data-ui="UI-SHELL-MODE"][data-location="account"]');
  if (!button) throw new Error("account mode control missing");
  return button as HTMLButtonElement;
}

describe("CS4-U1 Default shell navigation", () => {
  afterEach(() => {
    resetDisclosure();
  });

  it("renders Your OVRFLO, Create, and Activity in desktop nav and the mobile menu", () => {
    render(
      <Shell currentNav="home" wallet="CONNECT WALLET" network="Ethereum">
        body
      </Shell>,
    );
    const labels = ["Your OVRFLO", "Create", "Activity"];
    for (const label of labels) {
      expect(desktopNav().getByRole("link", { name: label })).toBeInTheDocument();
    }
    const menu = document.querySelector('[data-ui="UI-SHELL-MENU"]');
    expect(menu).not.toBeNull();
    for (const label of labels) {
      expect(within(menu as HTMLElement).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(desktopNav().getByRole("link", { name: "Your OVRFLO" })).toHaveAttribute("href", "/");
    expect(desktopNav().getByRole("link", { name: "Create" })).toHaveAttribute("href", "/create/");
    expect(desktopNav().getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/activity/");
  });

  it("does not offer Portfolio, Dashboard, or Markets destinations", () => {
    render(<Shell currentNav="home" wallet="CONNECT WALLET" />);
    expect(screen.queryByRole("link", { name: "Portfolio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PORTFOLIO" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Markets" })).not.toBeInTheDocument();
  });

  it("keeps wallet and network visible in both disclosure levels", () => {
    render(
      <Shell currentNav="create" wallet="CONNECT WALLET" network="Ethereum">
        body
      </Shell>,
    );
    expect(screen.getByText("CONNECT WALLET")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    fireEvent.click(accountMode());
    expect(getDisclosure()).toBe("advanced");
    expect(screen.getByText("CONNECT WALLET")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(document.querySelector('[data-ui="UI-SHELL"]')).toHaveAttribute("data-disclosure", "advanced");
  });

  it("exposes Go to Advanced in Default and Return to Default in Advanced without writing a query", () => {
    window.history.replaceState(null, "", "/create/?lending=0x1");
    render(
      <Shell currentNav="create" wallet="CONNECT WALLET">
        <DefaultHub welcome="Choose a position type" />
      </Shell>,
    );
    expect(accountMode()).toHaveTextContent("Go to Advanced");
    expect(window.location.search).toBe("?lending=0x1");
    fireEvent.click(accountMode());
    expect(accountMode()).toHaveTextContent("Return to Default");
    expect(window.location.search).toBe("?lending=0x1");
    expect(window.location.pathname).toBe("/create/");
    fireEvent.click(accountMode());
    expect(getDisclosure()).toBe("default");
    expect(window.location.search).toBe("?lending=0x1");
  });

  it("strips ?lens= on every Shell route without changing other query keys", async () => {
    window.history.replaceState(null, "", "/create/?lens=borrowed&step=1");
    render(<Shell currentNav="create" wallet="CONNECT WALLET" />);
    await waitFor(() => {
      expect(window.location.search).not.toMatch(/lens=/);
    });
    expect(window.location.pathname).toBe("/create/");
    expect(window.location.search).toBe("?step=1");
  });

  it("refresh-equivalent reset returns Default on the same destination", () => {
    setDisclosure("advanced");
    expect(getDisclosure()).toBe("advanced");
    resetDisclosure();
    expect(getDisclosure()).toBe("default");
  });
});

describe("CS4-U1 hub layout and create chooser", () => {
  afterEach(() => {
    resetDisclosure();
  });

  it("encodes welcome span, equal type columns, and 2:1 activity/help at the wide breakpoint", () => {
    const css = readFileSync(join(WEB_ROOT, "components/kit/kit.css"), "utf8");
    expect(css).toMatch(/@media \(min-width: 1024px\)/);
    expect(css).toMatch(/\.default-hub-welcome\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
    expect(css).toMatch(/\.default-hub-types\s*\{\s*grid-template-columns:\s*1fr 1fr;/);
    expect(css).toMatch(/\.default-hub-lower\s*\{\s*grid-template-columns:\s*2fr 1fr;/);
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    expect(css).toMatch(/\.kit-nav\s*\{\s*display:\s*none;/);
  });

  it("offers Self-Repaying Loan and Fixed Return on the create chooser", () => {
    render(<DefaultHub welcome="Choose a position type" />);
    expect(screen.getByRole("link", { name: /Self-Repaying Loan/ })).toHaveAttribute("href", "/borrow/");
    expect(screen.getByRole("link", { name: /Fixed Return/ })).toHaveAttribute("href", "/supply/");
  });
});
