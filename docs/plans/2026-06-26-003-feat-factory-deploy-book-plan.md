---
title: "feat: Factory-deployed OVRFLOBook"
type: feat
date: 2026-06-26
origin: docs/brainstorms/2026-06-26-factory-deploy-book-requirements.md
---

# Plan: Factory-deployed OVRFLOBook

## Summary

Add a `deployBook(address ovrflo)` function to `OVRFLOFactory` that deploys an `OVRFLOBook` for an existing vault, enforces 1:1 (one book per vault), registers the book address, and transfers ownership to the multisig. The factory reads the Sablier address from the deployed vault's `sablierLL` immutable.

## Problem Frame

When the multisig deploys a new OVRFLO vault, a corresponding OVRFLOBook is needed for that vault's lending market. Today the book is deployed via a separate off-chain script, which is error-prone and leaves no on-chain registry linking a vault to its book. Co-locating book deployment on the factory uses the existing access control and registry infrastructure. (See origin: `docs/brainstorms/2026-06-26-factory-deploy-book-requirements.md`)

---

## Requirements

**Factory function:**

- R1. `deployBook(address ovrflo)` is an `onlyOwner` function that deploys `new OVRFLOBook(address(this), ovrflo, sablierAddr)` and returns the book address
- R2. Reverts if the `ovrflo` is not a known vault (`_requireKnownOvrflo`)
- R3. Reverts if a book already exists for the vault (1:1 enforcement)
- R4. Stores the book address in a public mapping `ovrfloToBook`
- R5. Nominates the multisig as pending owner of the book after deployment (multisig calls `acceptOwnership` to finalize)
- R6. Reads the Sablier address from `OVRFLO(ovrflo).sablierLL()` rather than hardcoding it on the factory

**Tests:**

- R7. Tests cover: successful deployment, duplicate revert, unknown vault revert, non-owner revert, ownership transferred, book address registered, book bound to correct factory/core/sablier

**Documentation:**

- R8. README admin flows show `factory.deployBook(ovrflo)` as the deployment path
- R9. README architecture diagram shows the factory deploying the book
- R10. README OVRFLOFactory function table includes `deployBook`
- R11. `script/OVRFLOBook.s.sol` has a comment noting `factory.deployBook()` as the preferred path

---

## Key Technical Decisions

- **Read Sablier from the vault, not a factory constant.** The vault already has `sablierLL` as a public immutable. Reading it avoids duplicating the address and keeps the factory decoupled from Sablier's address. (See origin R6)
- **1:1 enforcement via mapping check.** A simple `ovrfloToBook[ovrflo] != address(0)` check prevents duplicate books. The mapping doubles as the public registry. (See origin R3, R4)
- **Ownership transfer in the same call.** The factory calls `OVRFLOBook.transferOwnership(owner())` immediately after deployment, nominating the multisig as pending owner. The multisig then calls `acceptOwnership` to finalize, same pattern as the factory deploy script. (See origin R5)

---

## Implementation Units

### U1. Add `deployBook` to OVRFLOFactory

**Goal:** Add the `deployBook` function, `ovrfloToBook` mapping, and `BookDeployed` event to the factory.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** None

**Files:**
- `src/OVRFLOFactory.sol` (modify)
- `src/OVRFLOBook.sol` (import)

**Approach:**

Add an import of `OVRFLOBook`. Add a public mapping `mapping(address => address) public ovrfloToBook` and a `BookDeployed` event. Add the `deployBook` function:

- Gate with `onlyOwner`
- Call `_requireKnownOvrflo(ovrflo)` to validate the vault is registered
- Check `ovrfloToBook[ovrflo] == address(0)` to enforce 1:1
- Read the Sablier address via `address(OVRFLO(ovrflo).sablierLL())`
- Deploy `new OVRFLOBook(address(this), ovrflo, sablierAddr)`
- Store the book address in `ovrfloToBook[ovrflo]`
- Call `book.transferOwnership(owner())` to nominate the multisig as pending owner
- Emit `BookDeployed` event
- Return the book address

**Patterns to follow:**
- `deploy()` function pattern in `src/OVRFLOFactory.sol` — same `onlyOwner` gating, event emission, and return-address pattern
- `_requireKnownOvrflo` helper used by `addMarket`, `setMarketDepositLimit`, `sweepExcessPt`, `sweepExcessUnderlying`

**Test scenarios:**
Test expectation: none — U2 covers all test scenarios for this change.

**Verification:**
- `forge build` compiles without errors
- `deployBook` function exists with correct signature
- `ovrfloToBook` mapping is public and readable

---

### U2. Add tests for `deployBook`

**Goal:** Comprehensive test coverage for the new `deployBook` function.

**Requirements:** R7

**Dependencies:** U1

**Files:**
- `test/OVRFLOFactory.t.sol` (modify)

**Approach:**

Use the existing `_deployConfiguredSystem()` helper to set up a vault, then test `deployBook` against it. Add an `import {OVRFLOBook}` at the top. Add a `BookDeployed` event declaration for `vm.expectEmit`.

**Patterns to follow:**
- `test_Deploy_DeploysSystemStoresAccountingAndTransfersTokenOwnership` — same pattern of deploying via factory, checking addresses, checking events
- `_deployConfiguredSystem()` helper for vault setup

**Test scenarios:**

- **Happy path — successful deployment:** Deploy a vault via `_deployConfiguredSystem()`, call `deployBook(ovrflo)` as OWNER, verify returned address is a contract, verify `ovrfloToBook[ovrflo]` matches, verify `BookDeployed` event emitted
- **Happy path — book bound to correct params:** After `deployBook`, verify the book's `factory` immutable is the factory address, `core` immutable is the vault address, `sablier` immutable matches `OVRFLO(ovrflo).sablierLL()`
- **Happy path — ownership transferred:** After `deployBook`, verify `book.pendingOwner() == OWNER` (two-step: transferOwnership nominates, multisig accepts later)
- **Error — duplicate book:** Call `deployBook` twice on the same vault, second call reverts with "OVRFLOFactory: book exists"
- **Error — unknown vault:** Call `deployBook(address(0xDEAD))`, reverts with "OVRFLOFactory: unknown ovrflo"
- **Error — non-owner:** Call `deployBook` as STRANGER, reverts with "Ownable: caller is not the owner"

**Verification:**
- `forge test --match-contract OVRFLOFactoryTest` passes with all new tests green
- No existing tests broken

---

### U3. Update README and script comment

**Goal:** Update documentation to reflect the new factory-based book deployment path.

**Requirements:** R8, R9, R10, R11

**Dependencies:** U1

**Files:**
- `README.md` (modify)
- `script/OVRFLOBook.s.sol` (modify)

**Approach:**

In `README.md`:
- Add `deployBook(ovrflo)` to the OVRFLOFactory function table with description
- Update the "Deploying the Book" admin flow subsection to show `factory.deployBook(ovrflo)` as the primary path, with the manual script as an alternative
- Update the architecture diagram to show the factory deploying the book (add an arrow from OVRFLOFactory to OVRFLOBook)

In `script/OVRFLOBook.s.sol`:
- Add a comment at the top noting that `factory.deployBook(ovrflo)` is the preferred deployment path for production, and this script remains for standalone/flexible deployment

**Patterns to follow:**
- Existing README function table format (Function | Description)
- Existing README admin flow code examples (Solidity snippets in fenced blocks)
- Existing ASCII architecture diagram style

**Test scenarios:**
Test expectation: none — documentation update, no behavioral change.

**Verification:**
- README function table includes `deployBook`
- README admin flows show `factory.deployBook(ovrflo)` as primary path
- README architecture diagram shows factory-to-book arrow
- `script/OVRFLOBook.s.sol` has the comment

---

## Scope Boundaries

### Outside this scope

- Separate BookFactory contract — rejected in favor of extending the existing factory
- Bundling book deployment into `deploy()` — rejected; vault and book deployment are intentionally separate
- Multiple books per vault — rejected; 1:1 is the design constraint
- Migrating existing test fixtures to use factory-based book deployment — not needed; direct deployment in tests is fine
- Changes to `script/OVRFLO.s.sol` — book deployment is a separate multisig action
- Changes to `test/OVRFLOBook.t.sol` or `test/fork/OVRFLOBookMainnetFork.t.sol` — unaffected, they deploy directly
