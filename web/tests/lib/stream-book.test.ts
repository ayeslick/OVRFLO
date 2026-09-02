import { describe, expect, it } from "vitest";
import {
  bookFields,
  foldStreamIds,
  nextPageParam,
  presentBook,
  windowStop,
} from "@/lib/stream-book";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";

describe("stream-book source cursor", () => {
  it("advances by page size while the window is inside sourceCount", () => {
    expect(nextPageParam(0n, 50n, STREAM_PAGE_SIZE)).toBe(STREAM_PAGE_SIZE);
    expect(nextPageParam(STREAM_PAGE_SIZE, 50n, STREAM_PAGE_SIZE)).toBeUndefined();
  });

  it("does not call a next page when sourceCount is 0", () => {
    expect(nextPageParam(0n, 0n, STREAM_PAGE_SIZE)).toBeUndefined();
  });

  it("clamps the window stop to sourceCount", () => {
    expect(windowStop(0n, 10n, STREAM_PAGE_SIZE)).toBe(10n);
    expect(windowStop(0n, 40n, STREAM_PAGE_SIZE)).toBe(STREAM_PAGE_SIZE);
  });

  it("keeps both ids when a duplicate appears — no Set unique", () => {
    const folded = foldStreamIds([
      { streams: [{ streamId: 1n }, { streamId: 2n }] },
      { streams: [{ streamId: 2n }] },
    ]);
    expect(folded.ids).toEqual([1n, 2n, 2n]);
    expect(folded.duplicate).toBe(2n);
  });

  it("requires zero unresolved failures for confirmedEmpty", () => {
    expect(
      bookFields({
        sourceCount: 0n,
        renderCount: 0,
        complete: true,
        unresolvedFailures: false,
      }).confirmedEmpty,
    ).toBe(true);
    expect(
      bookFields({
        sourceCount: 0n,
        renderCount: 0,
        complete: true,
        unresolvedFailures: true,
      }).confirmedEmpty,
    ).toBe(false);
    expect(
      bookFields({
        sourceCount: 20n,
        renderCount: 0,
        complete: false,
        unresolvedFailures: false,
      }).confirmedEmpty,
    ).toBe(false);
  });

  it("never returns ready when the inner book is incomplete", () => {
    const incomplete = {
      sourceCount: 40n,
      renderCount: 25,
      complete: false,
      confirmedEmpty: false,
    };
    const outcome = presentBook(incomplete, []);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.complete).toBe(false);
  });

  it("returns ready only when the inner book is complete", () => {
    const complete = {
      sourceCount: 2n,
      renderCount: 2,
      complete: true,
      confirmedEmpty: false,
    };
    const outcome = presentBook(complete, []);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.complete).toBe(true);
    expect(outcome.data.complete).toBe(true);
  });
});
