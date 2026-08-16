import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { bigintToSafeLength } from "@/hooks/useOvrflos";
import { discoverProtocolBootstrap } from "@/lib/protocol-bootstrap";
import { ZERO_ADDRESS } from "@/lib/config";

const FACTORY = "0x0000000000000000000000000000000000000f00" as Address;
const STREAM = "0x0000000000000000000000000000000000000b01" as Address;
const VAULT_A = "0x0000000000000000000000000000000000000a01" as Address;
const TREASURY = "0x0000000000000000000000000000000000000701" as Address;
const UNDERLYING = "0x0000000000000000000000000000000000000702" as Address;
const OVRFLO_TOKEN = "0x0000000000000000000000000000000000000703" as Address;
const LENDING = "0x0000000000000000000000000000000000000704" as Address;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;

function success<T>(result: T) {
  return { status: "success" as const, result };
}

function failure(error = new Error("reverted")) {
  return { status: "failure" as const, error };
}

describe("bigintToSafeLength", () => {
  it("fails a count beyond the validity budget instead of returning a partial prefix", () => {
    expect(bigintToSafeLength(3n)).toBe(3);
    expect(bigintToSafeLength(0n)).toBe(0);
    expect(bigintToSafeLength(1_000_000n)).toBe(0);
  });
});

describe("discoverProtocolBootstrap", () => {
  const client = {
    getBytecode: vi.fn(),
    getChainId: vi.fn(),
    getBlock: vi.fn(),
    multicall: vi.fn(),
  };

  beforeEach(() => {
    client.getBytecode.mockReset();
    client.getChainId.mockReset();
    client.getBlock.mockReset();
    client.multicall.mockReset();
    client.getBytecode.mockResolvedValue("0x6000");
    client.getChainId.mockResolvedValue(1);
    client.getBlock.mockResolvedValue({ number: 10n, hash: BLOCK_HASH });
  });

  it("is unavailable when the factory has no bytecode", async () => {
    client.getBytecode.mockResolvedValue("0x");
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result).toEqual({
      status: "unavailable",
      failures: [expect.objectContaining({ code: "no_code" })],
    });
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("rejects discovery on the wrong chain id", async () => {
    client.getChainId.mockResolvedValue(31337);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result).toEqual({
      status: "unavailable",
      failures: [expect.objectContaining({ code: "wrong_chain" })],
    });
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("fails closed when ovrfloStream() is unset", async () => {
    client.multicall.mockResolvedValueOnce([success(ZERO_ADDRESS), success(0n)]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.failures[0]?.code).toBe("rpc_revert");
      expect(result.failures[0]?.message).toMatch(/unset/i);
    }
  });

  it("fails closed when ovrfloStream() reverts", async () => {
    client.multicall.mockResolvedValueOnce([failure(), success(0n)]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result).toEqual({
      status: "unavailable",
      failures: [expect.objectContaining({ code: "rpc_revert", message: expect.stringMatching(/ovrfloStream/) })],
    });
  });

  it("fails closed when any registry index multicall item reverts", async () => {
    client.multicall
      .mockResolvedValueOnce([success(STREAM), success(1n)])
      .mockResolvedValueOnce([failure()]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.failures[0]?.code).toBe("rpc_revert");
      expect(result.failures[0]?.message).toMatch(/ovrflos\(0\)/);
    }
  });

  it("fails closed when ovrfloInfo reverts", async () => {
    client.multicall
      .mockResolvedValueOnce([success(STREAM), success(1n)])
      .mockResolvedValueOnce([success(VAULT_A)])
      .mockResolvedValueOnce([failure(), success(LENDING)]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.failures[0]?.message).toMatch(/ovrfloInfo/);
    }
  });

  it("fails closed when ovrfloToLending reverts", async () => {
    client.multicall
      .mockResolvedValueOnce([success(STREAM), success(1n)])
      .mockResolvedValueOnce([success(VAULT_A)])
      .mockResolvedValueOnce([
        success([TREASURY, UNDERLYING, OVRFLO_TOKEN]),
        failure(),
      ]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.failures[0]?.message).toMatch(/ovrfloToLending/);
    }
  });

  it("returns ready with an empty vault list when the registry is empty", async () => {
    client.multicall.mockResolvedValueOnce([success(STREAM), success(0n)]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result).toEqual({
      status: "ready",
      factory: FACTORY,
      stream: STREAM,
      vaults: [],
      blockNumber: 10n,
    });
  });

  it("assembles vault bindings from the second multicall pass", async () => {
    client.multicall
      .mockResolvedValueOnce([success(STREAM), success(1n)])
      .mockResolvedValueOnce([success(VAULT_A)])
      .mockResolvedValueOnce([
        success([TREASURY, UNDERLYING, OVRFLO_TOKEN]),
        success(LENDING),
      ]);
    const result = await discoverProtocolBootstrap(client, FACTORY, 1);
    expect(result).toEqual({
      status: "ready",
      factory: FACTORY,
      stream: STREAM,
      blockNumber: 10n,
      vaults: [
        {
          vault: VAULT_A,
          treasury: TREASURY,
          underlying: UNDERLYING,
          ovrfloToken: OVRFLO_TOKEN,
          lending: LENDING,
        },
      ],
    });
  });
});
