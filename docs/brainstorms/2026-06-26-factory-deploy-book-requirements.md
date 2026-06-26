---
date: 2026-06-26
topic: factory-deploy-book
---

# Factory-Deployed OVRFLOBook

## Summary

Add a `deployBook(address ovrflo)` function to `OVRFLOFactory` that deploys an `OVRFLOBook` for an existing vault, enforces 1:1 (one book per vault), registers the book address, and transfers ownership to the multisig.

## Problem Frame

When the multisig deploys a new OVRFLO vault for a new underlying asset, a corresponding OVRFLOBook is needed for that vault's lending market. Today the book is deployed via a separate off-chain script (`script/OVRFLOBook.s.sol`), which is error-prone: the multisig must run two independent operations, the book could be forgotten or deployed with wrong params, and there's no on-chain registry linking a vault to its book. Co-locating book deployment on the factory uses the existing access control and registry infrastructure, making the operation a single `onlyOwner` call.

---

## Key Decisions

- **Add to existing factory, not a separate BookFactory.** The factory already stores `ovrfloInfo[ovrflo]` (treasury, underlying, ovrfloToken) and is the source of truth the book reads from at construction. A separate factory would add another contract to audit and maintain with no real payoff.
- **Separate `deployBook()` function, not bundled into `deploy()`.** A vault may need markets onboarded before its book is useful. Keeping the two deployment steps separate lets the multisig deploy the vault, add markets, then deploy the book when ready.
- **1:1 enforcement (one book per vault).** Revert if a book already exists for the vault. Keeps the lending surface simple and avoids ambiguity about which book serves a vault.
- **Sablier as a constant on the factory.** Sablier V2 LL is already hardcoded as an immutable in `OVRFLO.sol` at the same singleton address. The factory can use the same constant rather than taking it as a constructor param.

---

## Requirements

**Factory function:**

- R1. `deployBook(address ovrflo)` is an `onlyOwner` function on `OVRFLOFactory` that deploys `new OVRFLOBook(address(this), ovrflo, SABLIER_LL)` and returns the book address
- R2. Reverts if the `ovrflo` is not a known vault (same `_requireKnownOvrflo` check used by other factory functions)
- R3. Reverts if a book already exists for the vault (1:1 enforcement via a mapping check)
- R4. Stores the book address in a public mapping (`ovrfloToBook`) so anyone can look up a vault's book on-chain
- R5. Transfers book ownership to the factory owner (the multisig) after deployment

**Constant:**

- R6. Read `SABLIER_LL` constant on `OVRFLO` and pass that in.

**Blast radius — tests:**

- R7. Add tests to `test/OVRFLOFactory.t.sol` covering: successful deployment, duplicate book revert, unknown vault revert, ownership transferred to factory owner, book address registered in mapping
- R8. Existing `test/OVRFLOBook.t.sol` tests deploy the book directly via `new OVRFLOBook(...)` and are unaffected; no changes needed
- R9. `test/fork/OVRFLOBookMainnetFork.t.sol` `_deployBook` helper deploys directly and is unaffected; no changes needed

**Blast radius — scripts:**

- R10. `script/OVRFLOBook.s.sol` remains as-is for standalone deployment, but add a comment noting `factory.deployBook()` as the preferred path
- R11. `script/OVRFLO.s.sol` does not need changes (book deployment is a separate multisig action, not part of the factory deploy script)

**Blast radius — documentation:**

- R12. Update `README.md` admin flows section to show `factory.deployBook(ovrflo)` as the deployment path, replacing the manual `new OVRFLOBook(...)` example
- R13. Update `README.md` architecture diagram to show the factory deploying the book (currently shows OVRFLOBook as a separate deployment)
- R14. Update `README.md` OVRFLOFactory function table to include `deployBook` and the `SABLIER_LL` constant

---

## Scope Boundaries

### Outside this scope

- Separate BookFactory contract — rejected in favor of extending the existing factory
- Bundling book deployment into `deploy()` — rejected; vault and book deployment are intentionally separate
- Multiple books per vault — rejected; 1:1 is the design constraint
- Migrating existing test fixtures to use factory-based book deployment — not needed; direct deployment in tests is fine
- Book deployment by non-owner — not supported; `onlyOwner` keeps it consistent with all other factory functions

---

## Sources

- `src/OVRFLOFactory.sol` — current factory with `deploy()`, `addMarket()`, `prepareOracle()`, `ovrfloInfo` mapping
- `src/OVRFLOBook.sol` — constructor `(factory, core, sablier)` pulls treasury/underlying/ovrfloToken from factory registry
- `src/OVRFLO.sol` — `sablierLL` hardcoded at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`
- `script/OVRFLOBook.s.sol` — current manual deployment script
- `test/OVRFLOFactory.t.sol` — existing factory tests
- `test/OVRFLOBook.t.sol` — book tests using direct `new OVRFLOBook(...)`
- `test/fork/OVRFLOBookMainnetFork.t.sol` — fork tests with `_deployBook` helper
