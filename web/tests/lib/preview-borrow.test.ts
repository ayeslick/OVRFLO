import { describe, expect, it } from "vitest";
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, type Hex } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { mapPreviewBorrowError, previewBorrowErrorName } from "@/components/borrow/quote";

/** keccak256("EmptyTick()")[:4] recorded from the generated lending ABI. */
const EMPTY_TICK_HEX = "0xdb44e47f" as Hex;
/** keccak256("BelowMinAcceptable()")[:4] — still zero-argument. */
const BELOW_MIN_ACCEPTABLE_HEX = "0xe4624cbf" as Hex;

const PREVIEW_RETURN_HEX =
  "0x0000000000000000000000000000000000000000000000003782dace9d900000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000000000000000000000000000003d0ff0b013b80000" as Hex;

const BORROWED_TOPICS: [Hex, ...Hex[]] = [
  "0x17d19b076773b377dff1b3adda433905a3a8c159f62b679cfa44a730f60a9fdf",
  "0x0000000000000000000000000000000000000000000000000000000000000001",
  "0x00000000000000000000000000000000000000000000000000000000000000a1",
  "0x00000000000000000000000000000000000000000000000000000000000000c3",
];

const BORROWED_DATA =
  "0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000003782dace9d900000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000000000000000000000000000003d0ff0b013b80000000000000000000000000000000000000000000000000000000000000000001f" as Hex;

describe("previewBorrow decode fixtures", () => {
  it("maps EmptyTick hex to zeros and not a query failure", () => {
    expect(previewBorrowErrorName({ data: EMPTY_TICK_HEX })).toBe("EmptyTick");
    expect(mapPreviewBorrowError({ data: EMPTY_TICK_HEX })).toEqual({
      emptyTick: true,
      actualBorrow: 0n,
      feeAmount: 0n,
      obligation: 0n,
    });
  });

  it("keeps BelowMinAcceptable zero-arg and does not treat it as a quote", () => {
    const decoded = decodeErrorResult({
      abi: ovrfloLendingAbi,
      data: BELOW_MIN_ACCEPTABLE_HEX,
    });
    expect(decoded.errorName).toBe("BelowMinAcceptable");
    expect(decoded.args).toBeUndefined();
    expect(
      ovrfloLendingAbi.find((item) => item.type === "error" && item.name === "BelowMinAcceptable"),
    ).toEqual({ type: "error", inputs: [], name: "BelowMinAcceptable" });
    expect(previewBorrowErrorName({ data: BELOW_MIN_ACCEPTABLE_HEX })).toBe("BelowMinAcceptable");
    expect(mapPreviewBorrowError({ data: BELOW_MIN_ACCEPTABLE_HEX })).toBeNull();
  });

  it("decodes a preview return equal to a subsequent Borrowed event", () => {
    const preview = decodeFunctionResult({
      abi: ovrfloLendingAbi,
      functionName: "previewBorrow",
      data: PREVIEW_RETURN_HEX,
    });
    const [actualBorrow, feeAmount, obligation] = preview as readonly [bigint, bigint, bigint];
    const event = decodeEventLog({
      abi: ovrfloLendingAbi,
      eventName: "Borrowed",
      data: BORROWED_DATA,
      topics: BORROWED_TOPICS,
    });
    expect(actualBorrow).toBe(4_000_000_000_000_000_000n);
    expect(feeAmount).toBe(10_000_000_000_000_000n);
    expect(obligation).toBe(4_400_000_000_000_000_000n);
    expect(event.args.actualBorrow).toBe(actualBorrow);
    expect(event.args.feeAmount).toBe(feeAmount);
    expect(event.args.obligation).toBe(obligation);
  });
});
