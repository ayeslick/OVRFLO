import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// R1/KTD3: Gherkin via playwright-bdd, not a hand-rolled runner. bddgen
// converts tests/e2e/**/*.feature into native Playwright tests under the
// gitignored .features-gen/ output (playwright-bdd's own convention).
const testDir = defineBddConfig({
  features: "tests/e2e/**/*.feature",
  steps: "tests/e2e/steps/**/*.ts",
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
