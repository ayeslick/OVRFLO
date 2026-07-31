#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { verifyDeploymentArtifactInput } from "../../tools/scripts/write-deployment-artifact.mjs";

const FIELD_BINDINGS = [
  ["factory", "NEXT_PUBLIC_OVRFLO_FACTORY"],
  ["factoryDeploymentBlock", "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK"],
  ["factoryDeploymentBlockHash", "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH"],
  ["ovrflo", "NEXT_PUBLIC_OVRFLO_ADDRESS"],
  ["lending", "NEXT_PUBLIC_OVRFLO_LENDING"],
  ["lendingDeploymentBlock", "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK"],
  ["lendingDeploymentBlockHash", "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH"],
  ["projectionSchemaVersion", "NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION"],
  ["abiVersion", "NEXT_PUBLIC_ABI_VERSION"],
];

/**
 * @param {Record<string, string | undefined>} environment
 * @param {typeof verifyDeploymentArtifactInput} verify
 */
export async function verifyDeploymentBuildInput(
  environment = process.env,
  verify = verifyDeploymentArtifactInput,
) {
  if (environment.NEXT_PUBLIC_RUNTIME_PROFILE !== "production") {
    throw new Error("verify-deployment-input: a deployable build requires the production profile");
  }
  const artifactPath = required(environment.OVRFLO_DEPLOYMENT_ARTIFACT, "OVRFLO_DEPLOYMENT_ARTIFACT");
  const rpcUrl = required(environment.DEPLOYMENT_RPC_URL, "DEPLOYMENT_RPC_URL");
  const verified = await verify({ artifactPath, rpcUrl, requireExistingIdentity: true });

  for (const [artifactField, environmentField] of FIELD_BINDINGS) {
    const configured = required(environment[environmentField], environmentField);
    if (!sameValue(verified[artifactField], configured)) {
      throw new Error(
        `verify-deployment-input: ${environmentField} does not match the verified deployment artifact`,
      );
    }
  }
  return verified;
}

function required(value, name) {
  if (!value) throw new Error(`verify-deployment-input: ${name} is required`);
  return value;
}

function sameValue(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verified = await verifyDeploymentBuildInput();
  process.stdout.write(
    `verify-deployment-input: verified factory block ${verified.factoryDeploymentBlock} and lending block ${verified.lendingDeploymentBlock}\n`,
  );
}
