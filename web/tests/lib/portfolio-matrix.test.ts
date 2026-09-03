import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  applyPortfolioSearch,
  classifyPortfolio,
  matrixFromCounts,
  ownsIdentity,
} from "@/lib/portfolio-matrix";

const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const OTHER = "0x5555555555555555555555555555555555555555" as Address;
const loan = (id: bigint, lending: Address = LENDING) => ({ lending, id });

describe("matrixFromCounts", () => {
  it("routes zero positions to empty", () => {
    expect(matrixFromCounts([], [])).toEqual({ kind: "empty" });
  });

  it("routes one loan to loan detail", () => {
    expect(matrixFromCounts([loan(1n)], [])).toEqual({
      kind: "detail",
      selection: { kind: "loan", lending: LENDING, id: 1n },
    });
  });

  it("routes one supply to fixed-return detail", () => {
    expect(matrixFromCounts([], [loan(8n)])).toEqual({
      kind: "detail",
      selection: { kind: "position", lending: LENDING, id: 8n },
    });
  });

  it("routes multiple loans and no supplies to the loan collection", () => {
    expect(matrixFromCounts([loan(1n), loan(2n)], [])).toEqual({
      kind: "collection",
      type: "loan",
    });
  });

  it("routes multiple supplies and no loans to the fixed collection", () => {
    expect(matrixFromCounts([], [loan(1n), loan(3n)])).toEqual({
      kind: "collection",
      type: "fixed",
    });
  });

  it("routes mixed types to the hub", () => {
    expect(matrixFromCounts([loan(1n)], [loan(2n)])).toEqual({ kind: "hub" });
  });
});

describe("classifyPortfolio", () => {
  it("stays incomplete while hydration is not complete", () => {
    expect(
      classifyPortfolio(
        { complete: false, loans: [loan(1n)], positions: [] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({ kind: "incomplete" });
  });

  it("keeps an owned deep-link detail after complete hydration", () => {
    expect(
      classifyPortfolio(
        { complete: true, loans: [loan(1n), loan(2n)], positions: [] },
        { type: "loan", selection: { kind: "loan", lending: LENDING, id: 2n } },
      ),
    ).toEqual({
      kind: "detail",
      selection: { kind: "loan", lending: LENDING, id: 2n },
    });
  });

  it("strips a stale identity and applies the matrix", () => {
    expect(
      classifyPortfolio(
        { complete: true, loans: [loan(1n), loan(2n)], positions: [] },
        { type: null, selection: { kind: "loan", lending: OTHER, id: 9n } },
      ),
    ).toEqual({ kind: "collection", type: "loan" });
  });

  it("keeps a mixed-type collection when the URL names that type", () => {
    expect(
      classifyPortfolio(
        { complete: true, loans: [loan(1n)], positions: [loan(2n)] },
        { type: "loan", selection: { kind: "none" } },
      ),
    ).toEqual({ kind: "collection", type: "loan" });
  });
});

describe("applyPortfolioSearch", () => {
  it("skips URL writes while the scan is incomplete", () => {
    expect(
      applyPortfolioSearch(
        { complete: false, loans: [loan(1n)], positions: [] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({ action: "skip" });
  });

  it("writes loan identity for one hydrated loan", () => {
    expect(
      applyPortfolioSearch(
        { complete: true, loans: [loan(4n)], positions: [] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({
      action: "write",
      type: null,
      selection: { kind: "loan", lending: LENDING, id: 4n },
    });
  });

  it("writes position identity for one hydrated supply", () => {
    expect(
      applyPortfolioSearch(
        { complete: true, loans: [], positions: [loan(5n)] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({
      action: "write",
      type: null,
      selection: { kind: "position", lending: LENDING, id: 5n },
    });
  });

  it("writes type for multiple same-type positions", () => {
    expect(
      applyPortfolioSearch(
        { complete: true, loans: [loan(1n), loan(2n)], positions: [] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({ action: "write", type: "loan", selection: { kind: "none" } });
  });

  it("writes neither type nor identity for a mixed hub", () => {
    expect(
      applyPortfolioSearch(
        { complete: true, loans: [loan(1n)], positions: [loan(2n)] },
        { type: null, selection: { kind: "none" } },
      ),
    ).toEqual({ action: "write", type: null, selection: { kind: "none" } });
  });

  it("keeps a stream identity instead of overwriting it with the matrix", () => {
    expect(
      applyPortfolioSearch(
        { complete: true, loans: [loan(1n)], positions: [] },
        { type: null, selection: { kind: "stream", id: 5n } },
      ),
    ).toEqual({
      action: "write",
      type: null,
      selection: { kind: "stream", id: 5n },
    });
  });

  it("routes one waiting request to stream detail", () => {
    expect(
      matrixFromCounts([], [], [{ lending: LENDING, requestId: 3n, streamId: 9n }]),
    ).toEqual({
      kind: "detail",
      selection: { kind: "stream", id: 9n },
    });
  });

  it("counts waiting requests as loan-type positions", () => {
    expect(
      matrixFromCounts([loan(1n)], [], [{ lending: LENDING, requestId: 3n, streamId: 9n }]),
    ).toEqual({ kind: "collection", type: "loan" });
  });

  it("does not treat a stale loan as owned", () => {
    expect(ownsIdentity([loan(1n)], OTHER, 1n)).toBe(false);
    expect(ownsIdentity([loan(1n)], LENDING, 1n)).toBe(true);
  });
});
