import { drainUnderlyingBalance } from "../fixtures/chain";
import { When } from "../fixtures/bdd";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";

When("my wstETH balance is drained", async () => {
  await drainUnderlyingBalance(DEV_WALLET_ADDRESS);
});
