import { createBdd } from "playwright-bdd";
import { test } from "./fork-snapshot";

// Every step file imports Given/When/Then from here (not from "playwright-bdd"
// directly) so every scenario automatically picks up the forkSnapshot auto
// fixture (evm_snapshot/evm_revert per scenario, KTD7) without each step file
// having to know it exists.
export const { Given, When, Then } = createBdd(test);
