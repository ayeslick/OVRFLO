import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import path from "path";

// Standalone config for the U9 frozen-block parity harness. Deliberately NOT
// part of the unit-test include set: these tests require a live seeded local
// Anvil fork (bootstrap:local) and read real chain state. Run with:
//   npx vitest run --config vitest.parity.config.ts
function envLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.resolve(__dirname, ".env.local"), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    const key = match?.[1];
    const value = match?.[2];
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests-live/**/*.test.ts"],
    env: envLocal(),
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
