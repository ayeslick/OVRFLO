import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ovrfloStreamArtifact = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../artifacts/OVRFLOStream.json"), "utf8"),
) as { abi: unknown };

export default defineConfig({
  out: "lib/generated.ts",
  contracts: [
    {
      name: "ovrfloStream",
      abi: ovrfloStreamArtifact.abi as never,
    },
  ],
  plugins: [
    foundry({
      project: "..",
      include: ["OVRFLOFactory.json", "OVRFLO.json", "OVRFLOLending.json"],
    }),
  ],
});
