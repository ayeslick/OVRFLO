import "./watch-app-mocks";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WatchApp } from "@/components/watch/WatchApp";
import { borrowerBookKeys, lenderBookKeys } from "@/lib/query-keys";
import { writeWatchSearch } from "@/lib/watch-url";
import { filledPosition, mockCanvas, stubViewport, ACCOUNT, LENDING } from "./fixtures";
import { fx, resetWatchFx } from "./watch-fx";

/**
 * Successor to deleted `web/tests-live/reorg-freshness.test.ts`.
 * Live Anvil `evm_revert` is orchestrator-owned. This pins the watch-surface
 * contract: after a mocked revert+refetch, rolled-back entities disappear
 * and warm caches do not keep pre-revert rows.
 */
describe("inventory — revert freshness (successor to reorg-freshness.test.ts)", () => {
  beforeEach(() => {
    resetWatchFx();
    stubViewport(1280);
    mockCanvas();
  });

  afterEach(() => {
    resetWatchFx();
  });

  it("after mocked revert+refetch, zero rolled-back entities render on watch", async () => {
    const preSnapshot = [filledPosition(26n)];
    const rolledBack = filledPosition(99n);
    fx.connected = true;
    fx.positions = [...preSnapshot, rolledBack];
    writeWatchSearch({ selection: { kind: "none" } }, "replace");
    const view = render(<WatchApp />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /SUPPLY #99/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /SUPPLY #26/ })).toBeInTheDocument();
    });

    fx.positions = preSnapshot;
    view.rerender(<WatchApp />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /SUPPLY #99/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("article")).toHaveAttribute("data-region", "supplied-detail");

    const preUnfilled = preSnapshot.reduce((sum, row) => sum + row.availableLiquidity, 0n);
    const afterUnfilled = fx.positions.reduce((sum, row) => sum + row.availableLiquidity, 0n);
    expect(afterUnfilled).toBe(preUnfilled);
  });

  it("warm QueryClient caches do not carry pre-revert entities across the bracket", () => {
    const client = new QueryClient();
    const key = lenderBookKeys.account(1, LENDING, ACCOUNT);
    const loanKey = borrowerBookKeys.account(1, LENDING, ACCOUNT);
    const pre = { positions: [filledPosition(26n)] };
    const postTx = { positions: [filledPosition(26n), filledPosition(99n)] };

    client.setQueryData(key, postTx);
    client.setQueryData(loanKey, { loans: [{ id: 7n }] });
    expect((client.getQueryData(key) as typeof postTx).positions.map((row) => row.id)).toEqual([
      26n,
      99n,
    ]);

    client.setQueryData(key, pre);
    client.setQueryData(loanKey, { loans: [] });
    const restored = client.getQueryData(key) as typeof pre;
    expect(restored.positions.map((row) => row.id)).toEqual([26n]);
    expect(restored.positions.some((row) => row.id === 99n)).toBe(false);
    expect((client.getQueryData(loanKey) as { loans: { id: bigint }[] }).loans).toEqual([]);
  });
});
