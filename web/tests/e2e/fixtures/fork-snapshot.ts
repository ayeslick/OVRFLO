// KTD7: per-scenario isolation on the one shared seeded fork. `evm_snapshot`
// before, `evm_revert` after — every journey mutates real chain state
// (supplies liquidity, opens loans, advances the clock past maturity), so
// scenarios must not see each other's leftovers even under `workers: 1`
// (see docs/solutions/architecture-patterns/e2e-shared-fork-requires-serial-
// workers-until-snapshot-isolation.md — that doc's `workers: 1` stays the
// config default until this fixture has been run under real parallel workers
// without observed races, which this ticket does not attempt).
//
// Every steps/*.ts file must import `test`/`createBdd` from *this* module
// (not from "playwright-bdd" directly), or its scenarios silently skip
// isolation.
import { test as base } from "playwright-bdd";
import { rpcCall } from "./rpc";

export const test = base.extend<{ forkSnapshot: void }>({
  forkSnapshot: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature requires the leading destructure even with no declared dependencies.
    async ({}, use) => {
      const snapshotId = await rpcCall<string>("evm_snapshot");
      await use();
      const reverted = await rpcCall<boolean>("evm_revert", [snapshotId]);
      if (!reverted) {
        throw new Error(
          `evm_revert(${snapshotId}) returned false — the fork may be in an inconsistent state for the next scenario`,
        );
      }
    },
    { auto: true },
  ],
});
