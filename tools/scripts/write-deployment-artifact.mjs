#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// keccak256("LendingRegistered(address,address)"); recomputed via `cast keccak
// "LendingRegistered(address,address)"` after the factory rename from LendingDeployed.
const LENDING_REGISTERED_TOPIC =
  "0x4fe43074b419acbe41e8428df134258612acf6435f32c53db0f6a4ba665b4e41";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// cast sig "sablierLL()" / cast sig "sablier()"
const SABLIER_LL_SELECTOR = "0x94cd301a";
const SABLIER_SELECTOR = "0x482879aa";
// cast sig "ovrfloStream()"
const OVRFLO_STREAM_SELECTOR = "0xce6bc9b5";
// cast sig "reserve()"
const RESERVE_SELECTOR = "0xcd3293de";
// cast sig "ovrfloToReserve(address)"
const OVRFLO_TO_RESERVE_SELECTOR = "0x82029b36";

export async function verifyDeploymentArtifactInput({
  artifactPath,
  rpcUrl,
  request = jsonRpcRequest,
  requireExistingIdentity = false,
}) {
  const absolutePath = resolve(artifactPath);
  const current = JSON.parse(readFileSync(absolutePath, "utf8"));
  requireArtifactGeneration(current);
  const factory = requiredAddress(current.factory, "factory");
  let ovrflo = optionalAddress(current.ovrflo, "ovrflo");
  let lending = optionalAddress(current.lending, "lending");
  let reserve = optionalAddress(current.reserve, "reserve");
  if (Boolean(ovrflo) !== Boolean(lending) || Boolean(ovrflo) !== Boolean(reserve)) {
    throw new Error("ovrflo, lending, and reserve must either both be present or both be derived");
  }

  const chainId = Number.parseInt(await request(rpcUrl, "eth_chainId", []), 16);
  if (chainId !== 1) throw new Error(`deployment artifact requires chain id 1; RPC returned ${chainId}`);

  const rpcRequest = (method, params) => request(rpcUrl, method, params);
  const latest = BigInt(await request(rpcUrl, "eth_blockNumber", []));
  const factoryDeploymentBlock = await findDeploymentBlock({
    address: factory,
    latest,
    request: rpcRequest,
  });
  // The lending contract's code-deployment transaction (forge create) and the
  // factory's registerLending call (cast send) are separate transactions in
  // separate blocks, so the registration event can land anywhere at or after
  // the factory's own deployment block. Search the full range rather than a
  // single block; the anchor is the event's block, not the code's block.
  const eventLogs = await request(rpcUrl, "eth_getLogs", [
    {
      address: factory,
      fromBlock: toQuantity(factoryDeploymentBlock),
      toBlock: toQuantity(latest),
      topics:
        ovrflo && lending
          ? [LENDING_REGISTERED_TOPIC, topicAddress(ovrflo), topicAddress(lending)]
          : [LENDING_REGISTERED_TOPIC],
    },
  ]);
  if (!ovrflo || !lending) {
    if (eventLogs.length !== 1) {
      throw new Error(
        `deployment artifact requires one unambiguous LendingRegistered event; found ${eventLogs.length}`,
      );
    }
    ovrflo = topicToAddress(eventLogs[0]?.topics?.[1], "LendingRegistered.ovrflo");
    lending = topicToAddress(eventLogs[0]?.topics?.[2], "LendingRegistered.lending");
  }
  const event = eventLogs.find(
    (log) =>
      sameHex(log.address, factory) &&
      sameHex(log.topics?.[1], topicAddress(ovrflo)) &&
      sameHex(log.topics?.[2], topicAddress(lending)),
  );
  if (!event?.blockNumber || !event.blockHash) {
    throw new Error("lending is not derived from a verified factory LendingRegistered event");
  }
  const lendingDeploymentBlock = BigInt(event.blockNumber);

  // Anchor semantics: lendingDeploymentBlock is the LendingRegistered event's
  // block, not the lending contract's code-deployment block. Code must exist
  // no later than the anchor (eventBlock >= codeBlock), not in the same block.
  const lendingCodeBlock = await findDeploymentBlock({
    address: lending,
    latest,
    request: rpcRequest,
  });
  if (lendingCodeBlock > lendingDeploymentBlock) {
    throw new Error("lending has no code at the LendingRegistered anchor block");
  }

  const factoryBlock = await request(rpcUrl, "eth_getBlockByNumber", [
    toQuantity(factoryDeploymentBlock),
    false,
  ]);
  const lendingBlock = await request(rpcUrl, "eth_getBlockByNumber", [
    toQuantity(lendingDeploymentBlock),
    false,
  ]);
  if (!factoryBlock?.hash || !lendingBlock?.hash) {
    throw new Error("deployment artifact could not resolve deployment block hashes");
  }

  if (
    !sameHex(event.blockHash, lendingBlock.hash) ||
    BigInt(event.blockNumber) !== lendingDeploymentBlock
  ) {
    throw new Error("lending is not derived from a verified factory LendingRegistered event");
  }

  const stream = await deriveStreamAddress({
    factory,
    ovrflo,
    lending,
    supplied: current.stream,
    request: rpcRequest,
  });
  reserve = await deriveReserveAddress({
    factory,
    ovrflo,
    supplied: current.reserve,
    request: rpcRequest,
  });

  const verified = {
    ...current,
    formatVersion: 1,
    projectionSchemaVersion: 1,
    abiVersion: 1,
    freshGeneration: true,
    chainId: 1,
    factory,
    factoryDeploymentBlock: factoryDeploymentBlock.toString(),
    factoryDeploymentBlockHash: factoryBlock.hash,
    ovrflo,
    lending,
    lendingDeploymentBlock: lendingDeploymentBlock.toString(),
    lendingDeploymentBlockHash: lendingBlock.hash,
    stream,
    reserve,
  };
  if (requireExistingIdentity) {
    for (const field of [
      "factory",
      "factoryDeploymentBlock",
      "factoryDeploymentBlockHash",
      "ovrflo",
      "lending",
      "lendingDeploymentBlock",
      "lendingDeploymentBlockHash",
      "stream",
      "reserve",
    ]) {
      if (!sameHexOrValue(current[field], verified[field])) {
        throw new Error(`${field} does not match the chain-verified deployment identity`);
      }
    }
  }
  return verified;
}

export async function verifyAndWriteDeploymentArtifact(options) {
  const verified = await verifyDeploymentArtifactInput(options);
  const absolutePath = resolve(options.artifactPath);
  const temporaryPath = `${absolutePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(verified, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, absolutePath);
  return verified;
}

async function deriveStreamAddress({ factory, ovrflo, lending, supplied, request }) {
  const factoryStream = decodeReturnedAddress(
    await request("eth_call", [{ to: factory, data: OVRFLO_STREAM_SELECTOR }, "latest"]),
    "factory.ovrfloStream()",
  );
  const vaultStream = decodeReturnedAddress(
    await request("eth_call", [{ to: ovrflo, data: SABLIER_LL_SELECTOR }, "latest"]),
    "vault.sablierLL()",
  );
  const lendingStream = decodeReturnedAddress(
    await request("eth_call", [{ to: lending, data: SABLIER_SELECTOR }, "latest"]),
    "lending.sablier()",
  );
  if (!sameHex(vaultStream, factoryStream)) {
    throw new Error("vault.sablierLL() does not match factory.ovrfloStream()");
  }
  if (!sameHex(lendingStream, factoryStream)) {
    throw new Error("lending.sablier() does not match factory.ovrfloStream()");
  }
  const code = await request("eth_getCode", [factoryStream, "latest"]);
  if (!code || code === "0x") {
    throw new Error("derived stream has no code");
  }
  if (supplied !== undefined && !sameHex(String(supplied), factoryStream)) {
    throw new Error("supplied stream does not match factory.ovrfloStream()");
  }
  return factoryStream;
}

async function deriveReserveAddress({ factory, ovrflo, supplied, request }) {
  const vaultReserve = decodeReturnedAddress(
    await request("eth_call", [{ to: ovrflo, data: RESERVE_SELECTOR }, "latest"]),
    "vault.reserve()",
  );
  const factoryReserve = decodeReturnedAddress(
    await request("eth_call", [
      {
        to: factory,
        data: `${OVRFLO_TO_RESERVE_SELECTOR}${ovrflo.slice(2).toLowerCase().padStart(64, "0")}`,
      },
      "latest",
    ]),
    "factory.ovrfloToReserve()",
  );
  if (!sameHex(vaultReserve, factoryReserve)) {
    throw new Error("vault.reserve() does not match factory.ovrfloToReserve()");
  }
  const code = await request("eth_getCode", [vaultReserve, "latest"]);
  if (!code || code === "0x") {
    throw new Error("derived reserve has no code");
  }
  if (supplied !== undefined && !sameHex(String(supplied), vaultReserve)) {
    throw new Error("supplied reserve does not match vault.reserve()");
  }
  return vaultReserve;
}

function decodeReturnedAddress(result, name) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error(`${name} did not return an address`);
  }
  return requiredAddress(`0x${result.slice(-40)}`, name);
}

export async function findDeploymentBlock({ address, latest, request }) {
  const latestCode = await request("eth_getCode", [address, toQuantity(latest)]);
  if (!latestCode || latestCode === "0x") {
    throw new Error(`${address} has no code at the current chain head`);
  }

  let low = 0n;
  let high = latest;
  while (low < high) {
    const middle = (low + high) / 2n;
    const code = await request("eth_getCode", [address, toQuantity(middle)]);
    if (code && code !== "0x") high = middle;
    else low = middle + 1n;
  }
  return low;
}

export async function jsonRpcRequest(rpcUrl, method, params, timeoutMs = 30_000) {
  let response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`deployment RPC transport failed during ${method}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`deployment RPC returned HTTP ${response.status} during ${method}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`deployment RPC rejected ${method} with code ${body.error.code ?? "unknown"}`);
  }
  return body.result;
}

function requiredAddress(value, name) {
  if (typeof value !== "string" || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must be a non-zero Ethereum address`);
  }
  return value;
}

function optionalAddress(value, name) {
  return value === undefined ? undefined : requiredAddress(value, name);
}

function requireArtifactGeneration(artifact) {
  for (const [field, expected] of [
    ["formatVersion", 1],
    ["projectionSchemaVersion", 1],
    ["abiVersion", 1],
    ["chainId", 1],
  ]) {
    if (artifact[field] !== expected) throw new Error(`${field} must equal ${expected}`);
  }
  if (artifact.freshGeneration !== true) {
    throw new Error("freshGeneration must be true; reused generations require a migration plan");
  }
}

function topicAddress(address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function topicToAddress(topic, name) {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    throw new Error(`${name} topic is invalid`);
  }
  return `0x${topic.slice(-40)}`;
}

function toQuantity(value) {
  return `0x${value.toString(16)}`;
}

function sameHex(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function sameHexOrValue(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifactPath = process.argv[2];
  const rpcUrl = process.env.DEPLOYMENT_RPC_URL;
  if (!artifactPath || !rpcUrl) {
    throw new Error(
      "usage: DEPLOYMENT_RPC_URL=<redacted RPC> node tools/scripts/write-deployment-artifact.mjs <artifact.json>",
    );
  }
  const artifact = await verifyAndWriteDeploymentArtifact({ artifactPath, rpcUrl });
  process.stdout.write(
    `write-deployment-artifact: verified ${artifactPath} at factory block ${artifact.factoryDeploymentBlock} and lending block ${artifact.lendingDeploymentBlock}\n`,
  );
}
