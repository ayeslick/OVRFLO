import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "type-tests/**/*.test.ts"],
    coverage: {
      // R3/KTD5: informational only, no CI gate, no per-file threshold.
      provider: "v8",
      include: ["lib/**", "hooks/**"],
      exclude: ["lib/generated.ts", "lib/wagmi.ts"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Unit tests exercise the production wallet runtime — the E2E one is
      // reachable only through the Turbopack alias in next.config.ts.
      "wallet-runtime": path.resolve(__dirname, "./components/WalletRuntime.tsx"),
    },
  },
});
