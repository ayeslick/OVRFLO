import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// R1/KTD3: Gherkin via playwright-bdd, not a hand-rolled runner. bddgen
// converts tests/e2e/**/*.feature into native Playwright tests under the
// gitignored .features-gen/ output (playwright-bdd's own convention).
const testDir = defineBddConfig({
  features: "tests/e2e/**/*.feature",
  // fixtures/fork-snapshot.ts must be included here (not just steps/) so
  // bddgen can discover the custom `test` instance (forkSnapshot's auto
  // evm_snapshot/evm_revert, KTD7) that fixtures/bdd.ts binds Given/When/Then
  // to — it can't be inferred from the steps glob alone.
  steps: ["tests/e2e/steps/**/*.ts", "tests/e2e/fixtures/**/*.ts"],
});

export default defineConfig({
  testDir,
  // KTD7: every journey mutates the one shared seeded fork. Serial workers
  // is the documented fallback until fork-snapshot.ts proves per-scenario
  // isolation reliable under real parallelism (see tests/e2e/README.md).
  workers: 1,
  reporter: "list",
  use: {
    // KTD8/R2: no CI exists yet, so this has no CI-conditional branches
    // (forbidOnly, retries) — add them if/when CI wiring actually lands.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
