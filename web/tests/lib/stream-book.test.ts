import { describe, expect, it } from "vitest";
import {
  bookFields,
  foldStreamIds,
  nextPageParam,
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
});
