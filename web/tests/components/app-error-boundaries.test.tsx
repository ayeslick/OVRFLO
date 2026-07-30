import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import RouteError from "@/app/error";
import GlobalError from "@/app/global-error";
import Loading from "@/app/loading";

describe("static-export error boundaries", () => {
  it("renders route recovery and retries without exposing diagnostics", () => {
    const reset = vi.fn();
    render(<RouteError error={new Error("secret rpc url https://key.example")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/no transaction was submitted/i);
    expect(screen.queryByText(/secret rpc url/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders the document structure required by the global boundary", () => {
    const markup = renderToStaticMarkup(
      <GlobalError error={new Error("boom")} reset={vi.fn()} />,
    );
    expect(markup).toMatch(/^<html/);
    expect(markup).toContain("<body");
    expect(markup).toContain("RELOAD APPLICATION");
  });

  it("renders an explicit route loading state without browser discovery", () => {
    const markup = renderToStaticMarkup(<Loading />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("LOADING MARKETS");
  });
});
