import {
  isAddress,
  parseAbiItem,
  type Address,
  type Hash,
} from "viem";

export const DEPLOYMENT_FORMAT_VERSION = 1;
export const PROJECTION_SCHEMA_VERSION = 1;
export const ABI_VERSION = 1;

const lendingRegisteredEvent = parseAbiItem(
  "event LendingRegistered(address indexed ovrflo, address indexed lending)",
);

export type DeploymentArtifact = {
  formatVersion: 1;
  projectionSchemaVersion: 1;
  abiVersion: 1;
  freshGeneration: true;
  chainId: 1;
  factory: Address;
  factoryDeploymentBlock: bigint;
  factoryDeploymentBlockHash: Hash;
  ovrflo: Address;
  lending: Address;
  lendingDeploymentBlock: bigint;
  lendingDeploymentBlockHash: Hash;
};

type VerificationClient = {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hash | null }>;
  getCode(args: { address: Address; blockNumber: bigint }): Promise<`0x${string}` | undefined>;
  getLogs(args: {
    address: Address;
    event: typeof lendingRegisteredEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<
    Array<{
      args?: { ovrflo?: Address; lending?: Address };
      blockNumber: bigint | null;
      blockHash: Hash | null;
    }>
  >;
};

export function parseDeploymentArtifact(value: unknown): DeploymentArtifact {
  if (!value || typeof value !== "object") throw new Error("deployment artifact must be an object");
  const record = value as Record<string, unknown>;

  expectLiteral(record, "formatVersion", DEPLOYMENT_FORMAT_VERSION);
  expectLiteral(record, "projectionSchemaVersion", PROJECTION_SCHEMA_VERSION);
  expectLiteral(record, "abiVersion", ABI_VERSION);
  expectLiteral(record, "chainId", 1);
  if (record.freshGeneration !== true) {
    throw new Error("freshGeneration must be true; existing generations require a migration plan");
  }

  return {
    formatVersion: DEPLOYMENT_FORMAT_VERSION,
    projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
    abiVersion: ABI_VERSION,
    freshGeneration: true,
    chainId: 1,
    factory: expectAddress(record, "factory"),
    factoryDeploymentBlock: expectBlockNumber(record, "factoryDeploymentBlock"),
    factoryDeploymentBlockHash: expectHash(record, "factoryDeploymentBlockHash"),
    ovrflo: expectAddress(record, "ovrflo"),
    lending: expectAddress(record, "lending"),
    lendingDeploymentBlock: expectBlockNumber(record, "lendingDeploymentBlock"),
    lendingDeploymentBlockHash: expectHash(record, "lendingDeploymentBlockHash"),
  };
}

export async function verifyDeploymentArtifact(
  client: VerificationClient,
  artifact: DeploymentArtifact,
) {
  const latest = await client.getBlockNumber();
  if (artifact.factoryDeploymentBlock > latest) {
    throw new Error("factory deployment anchor is in the future");
  }
  if (artifact.lendingDeploymentBlock > latest) {
    throw new Error("lending deployment anchor is in the future");
  }

  const factoryBlock = await client.getBlock({ blockNumber: artifact.factoryDeploymentBlock });
  if (!sameHex(factoryBlock.hash, artifact.factoryDeploymentBlockHash)) {
    throw new Error("factory deployment block hash does not match the configured anchor");
  }
  const factoryCode = await client.getCode({
    address: artifact.factory,
    blockNumber: artifact.factoryDeploymentBlock,
  });
  if (!factoryCode || factoryCode === "0x") {
    throw new Error("factory has no code at its deployment anchor");
  }

  // artifact.lendingDeploymentBlock anchors to the LendingRegistered event's block, not
  // the lending contract's code-deployment block — code deployment (forge create) and
  // registration (registerLending) are separate transactions under the register-don't-
  // construct factory. The equality check against the event's blockNumber below still
  // holds because the artifact block IS the registration-event block.
  const lendingBlock = await client.getBlock({ blockNumber: artifact.lendingDeploymentBlock });
  if (!sameHex(lendingBlock.hash, artifact.lendingDeploymentBlockHash)) {
    throw new Error("lending deployment block hash does not match the configured anchor");
  }
  const lendingCode = await client.getCode({
    address: artifact.lending,
    blockNumber: artifact.lendingDeploymentBlock,
  });
  if (!lendingCode || lendingCode === "0x") {
    throw new Error("lending has no code at its deployment anchor");
  }

  const logs = await client.getLogs({
    address: artifact.factory,
    event: lendingRegisteredEvent,
    fromBlock: artifact.lendingDeploymentBlock,
    toBlock: artifact.lendingDeploymentBlock,
  });
  const matching = logs.find(
    (log) =>
      sameHex(log.args?.ovrflo, artifact.ovrflo) &&
      sameHex(log.args?.lending, artifact.lending) &&
      log.blockNumber === artifact.lendingDeploymentBlock &&
      sameHex(log.blockHash, artifact.lendingDeploymentBlockHash),
  );
  if (!matching) {
    throw new Error("lending identity is not derived from a verified factory LendingRegistered event");
  }

  return {
    factoryBlockHash: artifact.factoryDeploymentBlockHash,
    lendingBlockHash: artifact.lendingDeploymentBlockHash,
  };
}

function expectLiteral(record: Record<string, unknown>, key: string, expected: number) {
  if (record[key] !== expected) throw new Error(`${key} must equal ${expected}`);
}

function expectAddress(record: Record<string, unknown>, key: string): Address {
  const value = record[key];
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${key} must be a valid address`);
  }
  if (value.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${key} must not be the zero address`);
  }
  return value;
}

function expectBlockNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (
    (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") ||
    !/^(0|[1-9][0-9]*)$/.test(String(value))
  ) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return BigInt(value);
}

function expectHash(record: Record<string, unknown>, key: string): Hash {
  const value = record[key];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${key} must be a 32-byte hex hash`);
  }
  return value as Hash;
}

function sameHex(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
