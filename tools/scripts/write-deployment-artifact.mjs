#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LENDING_DEPLOYED_TOPIC =
  "0x56aab5483cc40d7e4e6b3ce2831f55ce79d54c537d1c695c2d86656ce7a84307";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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
  if (Boolean(ovrflo) !== Boolean(lending)) {
    throw new Error("ovrflo and lending must either both be present or both be derived");
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
  let lendingCodeBlock =
    ovrflo && lending
      ? await findDeploymentBlock({
          address: lending,
          latest,
          request: rpcRequest,
        })
      : undefined;
  const eventLogs = await request(rpcUrl, "eth_getLogs", [
    {
      address: factory,
      fromBlock: toQuantity(lendingCodeBlock ?? factoryDeploymentBlock),
      toBlock: toQuantity(lendingCodeBlock ?? latest),
      topics:
        ovrflo && lending
          ? [LENDING_DEPLOYED_TOPIC, topicAddress(ovrflo), topicAddress(lending)]
          : [LENDING_DEPLOYED_TOPIC],
    },
  ]);
  if (!ovrflo || !lending) {
    if (eventLogs.length !== 1) {
      throw new Error(
        `deployment artifact requires one unambiguous LendingDeployed event; found ${eventLogs.length}`,
      );
    }
    ovrflo = topicToAddress(eventLogs[0]?.topics?.[1], "LendingDeployed.ovrflo");
    lending = topicToAddress(eventLogs[0]?.topics?.[2], "LendingDeployed.lending");
    lendingCodeBlock = await findDeploymentBlock({
      address: lending,
      latest,
      request: rpcRequest,
    });
  }
  const event = eventLogs.find(
    (log) =>
      sameHex(log.address, factory) &&
      sameHex(log.topics?.[1], topicAddress(ovrflo)) &&
      sameHex(log.topics?.[2], topicAddress(lending)),
  );
  if (!event?.blockNumber || !event.blockHash) {
    throw new Error("lending is not derived from a verified factory LendingDeployed event");
  }
  const lendingDeploymentBlock = BigInt(event.blockNumber);
  if (lendingCodeBlock !== lendingDeploymentBlock) {
    throw new Error("lending code deployment block does not match LendingDeployed");
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
    throw new Error("lending is not derived from a verified factory LendingDeployed event");
  }

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
