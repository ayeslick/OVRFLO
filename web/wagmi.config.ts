import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "lib/generated.ts",
  plugins: [
    foundry({
      project: "..",
      include: ["OVRFLOFactory.json", "OVRFLO.json", "OVRFLOLending.json"],
    }),
  ],
});
