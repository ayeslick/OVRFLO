// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {OVRFLO} from "./OVRFLO.sol";
import {OVRFLOReserve} from "./OVRFLOReserve.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {OVRFLOLending} from "./OVRFLOLending.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {IStandardizedYield} from "../interfaces/IStandardizedYield.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

/// @dev Comptroller `admin()` read used only by `setOvrfloStream`. Not a new named protocol contract.
interface IStreamComptrollerAdmin {
    function admin() external view returns (address);
}

/// @title OVRFLOFactory
/// @notice Registry and admin hub for externally deployed OVRFLO systems
/// @dev Owned by a timelocked multisig. Children are deployed externally and registered
///      after on-chain verification of every constructor-arg binding; the factory embeds
///      no child creation code (EIP-170) and serves as the immutable `factory` (admin)
///      for every OVRFLO it registers. Ownership uses the OZ two-step pattern
///      (`transferOwnership` -> `acceptOwnership`).
contract OVRFLOFactory is Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public constant FEE_MAX_BPS = 100;
    uint32 public constant MIN_TWAP_DURATION = 15 minutes;
    uint32 public constant MAX_TWAP_DURATION = 30 minutes;

    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev A required constructor or admin-call address argument was the zero address.
    error ZeroAddress();
    /// @dev `registerOvrflo` was called for an underlying that already has a registered vault.
    error UnderlyingAlreadyDeployed();
    /// @dev `registerOvrflo` was called for a vault that is already registered.
    error AlreadyRegistered();
    /// @dev The candidate's `factory` immutable is not this factory.
    error FactoryMismatch();
    /// @dev The candidate vault's `oracle` immutable is not this factory's oracle.
    error OracleMismatch();
    /// @dev The candidate lending's owner is not this factory.
    error OwnerMismatch();
    /// @dev The candidate lending's Sablier binding does not match its vault's.
    error SablierMismatch();
    /// @dev `registerLending` was called for a vault that already has a lending market.
    error LendingExists();
    /// @dev `feeBps` exceeds `FEE_MAX_BPS`.
    error FeeTooHigh();
    /// @dev The Pendle oracle needs additional cardinality before this TWAP duration is usable.
    error OracleCardinalityRequired();
    /// @dev The Pendle oracle lacks sufficient historical data for this TWAP duration.
    error OracleNotReady();
    /// @dev The market's SY yield token does not match the vault's underlying.
    error UnderlyingMismatch();
    /// @dev The Pendle market has already reached its expiry.
    error MarketExpired();
    /// @dev The supplied address has no OVRFLO vault registered with this factory.
    error UnknownOvrflo();
    /// @dev The supplied address has no OVRFLOLending registered with this factory.
    error UnknownLending();
    /// @dev `twapDuration` is below `MIN_TWAP_DURATION`.
    error TwapTooShort();
    /// @dev `twapDuration` exceeds `MAX_TWAP_DURATION`.
    error TwapTooLong();
    /// @dev Canonical OVRFLO Stream is not set yet.
    error OvrfloStreamUnset();
    /// @dev `setOvrfloStream` was already called.
    error OvrfloStreamAlreadySet();
    /// @dev The candidate binds a stream other than `ovrfloStream`.
    error StreamNotCanonical();
    /// @dev `stream.factory()` is not this factory.
    error StreamFactoryMismatch();
    /// @dev `stream.admin()` is not this factory.
    error StreamAdminMismatch();
    /// @dev `stream.comptroller().admin()` is not this factory.
    error ComptrollerAdminMismatch();
    /// @dev The supplied address has no code.
    error NoCode();
    /// @dev The candidate token's `vault()` or `reserve()` does not match the vault.
    error TokenMinterMismatch();
    /// @dev The candidate reserve is missing or its bindings do not match the column.
    error ReserveMismatch();

    /// @notice Registry row for one OVRFLO vault.
    /// @dev Field 0 is `treasury` and stays field 0. The off-repo OVRFLO Stream mint
    ///      gate (`IOVRFLOFactoryRegistry.ovrfloInfo`) reads this tuple positionally.
    ///      `src/StreamPricing.sol` holds a third hand-written copy of the same order.
    ///      A field reorder would keep the mint gate passing while reading `underlying`.
    struct OvrfloInfo {
        address treasury;
        address underlying;
        address ovrfloToken;
    }

    uint256 public ovrfloCount;
    mapping(uint256 => address) public ovrflos;
    mapping(address => OvrfloInfo) public ovrfloInfo;

    mapping(address ovrflo => uint256) public approvedMarketCount;
    mapping(address ovrflo => mapping(uint256 index => address)) public approvedMarketAt;
    mapping(address ovrflo => mapping(address market => bool)) public isMarketApproved;

    /// @notice Maps an OVRFLO vault to its deployed OVRFLOLending (1:1).
    mapping(address => address) public ovrfloToLending;

    /// @notice Maps an OVRFLO vault to its wrap reserve. Write-once at `registerOvrflo`.
    /// @dev A flawed reserve is a new-column plus voluntary migration problem (pattern #9).
    ///      This mapping has no setter after admission and no `replaceReserve`.
    mapping(address => address) public ovrfloToReserve;

    /// @notice Reverse lookup: OVRFLOLending address => OVRFLO vault address.
    mapping(address => address) public lendingToOvrflo;

    /// @notice Total number of OVRFLOLending markets deployed by this factory.
    uint256 public lendingCount;

    /// @notice Enumerable list of all OVRFLOLending addresses deployed by this factory.
    mapping(uint256 => address) public lendings;

    /// @notice Maps an underlying asset to its deployed OVRFLO vault (1:1, prevents duplicates).
    mapping(address => address) public underlyingToOvrflo;

    /// @notice Pendle TWAP oracle address (singleton, same for all markets)
    address public immutable oracle;

    /// @notice Canonical OVRFLO Stream lockup. Set once via `setOvrfloStream`.
    address public ovrfloStream;

    /// @notice Number of routers that once held `lending.router()` and were swapped out or cleared.
    /// @dev History, not admission. The factory does not register a book. A listed router can
    ///      hold the slot again after a later `setLendingRouter`; readers compare against
    ///      `lending.router()` to learn which book is live. Append-only. Never pruned.
    mapping(address lending => uint256 count) public priorRouterCount;

    /// @notice `lending` => zero-based index => outgoing router recorded at swap or clear time.
    mapping(address lending => mapping(uint256 index => address router)) public priorRouterAt;

    /// @notice `lending` => router => already listed in `priorRouterAt`.
    /// @dev O(1) dedupe so an A -> B -> A cycle lists each address once.
    mapping(address lending => mapping(address router => bool listed)) public isPriorRouter;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event OvrfloRegistered(
        address indexed ovrflo, address indexed ovrfloToken, address treasury, address indexed underlying
    );
    event LendingRegistered(address indexed ovrflo, address indexed lending);
    event LendingReplaced(address indexed ovrflo, address indexed oldLending, address indexed newLending);
    event LendingAprBoundsSet(address indexed lending, uint16 aprMinBps, uint16 aprMaxBps);
    event LendingFeeSet(address indexed lending, uint16 feeBps);
    event LendingTreasurySet(address indexed lending, address indexed treasury);
    event LendingTickSpacingSet(address indexed lending, address indexed market, uint16 spacing);
    event LendingRouterSet(address indexed lending, address indexed router);
    event OvrfloStreamSet(address indexed stream);
    event StreamNFTDescriptorSet(address indexed descriptor);
    event ReserveFlashMintMaxSet(address indexed ovrflo, uint256 max);
    event ReserveFlashFeeBpsSet(address indexed ovrflo, uint16 bps);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner, address _oracle) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_oracle == address(0)) revert ZeroAddress();
        _transferOwnership(_owner);
        oracle = _oracle;
    }

    /*//////////////////////////////////////////////////////////////
                              REGISTRATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Register an externally deployed OVRFLO vault with this factory
    /// @dev On-chain checks prove constructor-arg wiring. Code identity stays off-chain.
    ///      Multisig checklist before calling (not duplicated on-chain):
    ///      (1) three creation transactions match the audited compiler artifacts — the
    ///          vault creation tx, the nested reserve creation, and the nested token
    ///          creation. Runtime-only comparison masks immutable slots and misses the
    ///          children the vault constructor embeds;
    ///      (2) token name/symbol carry the "OVRFLO "/"ovrflo" prefixes and fit 64/32 bytes;
    ///      (3) treasury and underlying are the intended values.
    ///      After those off-chain items, this function also checks: token and reserve
    ///      carry runtime code (`NoCode`); `token.vault() == ovrflo` and
    ///      `token.reserve() == vault.reserve()` (`TokenMinterMismatch`); reserve binds
    ///      that token, that underlying, this factory, and this vault (`ReserveMismatch`).
    ///      `ovrfloToReserve` is write-once. A flawed reserve is a new-column migration.
    /// @param ovrflo The externally deployed OVRFLO vault address
    function registerOvrflo(address ovrflo) external onlyOwner {
        if (ovrflo == address(0)) revert ZeroAddress();
        if (ovrfloInfo[ovrflo].treasury != address(0)) revert AlreadyRegistered();

        OVRFLO vault = OVRFLO(ovrflo);
        if (ovrfloStream == address(0)) revert OvrfloStreamUnset();
        if (address(vault.sablierLL()) != ovrfloStream) revert StreamNotCanonical();
        if (vault.factory() != address(this)) revert FactoryMismatch();
        if (vault.oracle() != oracle) revert OracleMismatch();

        address underlying = vault.underlying();
        if (underlyingToOvrflo[underlying] != address(0)) revert UnderlyingAlreadyDeployed();

        address ovrfloToken = vault.ovrfloToken();
        address reserve = vault.reserve();
        address treasury = vault.TREASURY_ADDR();

        // Zero reserve is a missing binding (`ReserveMismatch`), not an EOA (`NoCode`).
        if (reserve == address(0)) revert ReserveMismatch();
        if (ovrfloToken.code.length == 0 || reserve.code.length == 0) revert NoCode();

        OVRFLOToken token_ = OVRFLOToken(ovrfloToken);
        if (token_.vault() != ovrflo || token_.reserve() != reserve) revert TokenMinterMismatch();

        OVRFLOReserve reserve_ = OVRFLOReserve(reserve);
        if (
            reserve_.ovrfloToken() != ovrfloToken || reserve_.underlying() != underlying
                || reserve_.factory() != address(this) || reserve_.vault() != ovrflo
        ) {
            revert ReserveMismatch();
        }

        ovrflos[ovrfloCount] = ovrflo;
        ovrfloCount += 1;
        ovrfloInfo[ovrflo] = OvrfloInfo({treasury: treasury, underlying: underlying, ovrfloToken: ovrfloToken});
        underlyingToOvrflo[underlying] = ovrflo;
        ovrfloToReserve[ovrflo] = reserve;

        emit OvrfloRegistered(ovrflo, ovrfloToken, treasury, underlying);
    }

    /// @notice Register an externally deployed OVRFLOLending with this factory (1:1 per vault)
    /// @dev Same off-chain creation-code-verification checklist item as `registerOvrflo`.
    ///      The lending's constructor already binds `underlying`/`ovrfloToken` from this
    ///      factory's registry (it reverts unless its core is registered here), so only the
    ///      factory, owner, and Sablier bindings need verification. The factory must be the
    ///      lending's owner so all admin calls flow through the factory forwarders.
    ///      `SablierMismatch` still means vault and lending bind different streams.
    ///      `StreamNotCanonical` means the bound stream is not `ovrfloStream`. This
    ///      function does not re-check `stream.factory()`, `stream.admin()`, or
    ///      `comptroller.admin()` — `setOvrfloStream` already did.
    /// @param lending The externally deployed OVRFLOLending address
    function registerLending(address lending) external onlyOwner {
        address ovrflo = _verifyLendingCandidate(lending);
        if (ovrfloToLending[ovrflo] != address(0)) revert LendingExists();

        ovrfloToLending[ovrflo] = lending;
        lendingToOvrflo[lending] = ovrflo;
        lendings[lendingCount] = lending;
        lendingCount += 1;

        emit LendingRegistered(ovrflo, lending);
    }

    /// @notice Admit a new lending market for a vault that already has one.
    /// @dev Operator order: deploy the new market, call `replaceLending(new)`, call
    ///      `setLendingRouter(new, book)` once a request book bound to the new market
    ///      exists, then call `setLendingRouter(old, address(0))` so the old book stops
    ///      filling. The old book stays in `priorRouterAt(old, ·)` so `cancel` stays
    ///      discoverable.
    ///      First admission uses `registerLending`. A candidate already in
    ///      `lendingToOvrflo` reverts `LendingExists` so `lendings` stays unique.
    ///      The old market stays in `lendingToOvrflo` and `lendings` so factory admin
    ///      and permissionless `repay`/`close`/`claim` still reach it. The reserve is
    ///      not replaceable.
    /// @param newLending The externally deployed replacement OVRFLOLending address
    function replaceLending(address newLending) external onlyOwner {
        address ovrflo = _verifyLendingCandidate(newLending);
        address oldLending = ovrfloToLending[ovrflo];
        if (oldLending == address(0)) revert UnknownLending();
        if (lendingToOvrflo[newLending] != address(0)) revert LendingExists();

        ovrfloToLending[ovrflo] = newLending;
        lendingToOvrflo[newLending] = ovrflo;
        lendings[lendingCount] = newLending;
        lendingCount += 1;

        emit LendingReplaced(ovrflo, oldLending, newLending);
    }

    /*//////////////////////////////////////////////////////////////
                     MARKET DEPLOYMENT (PER-SERIES)
    //////////////////////////////////////////////////////////////*/

    /// @notice Add a PT maturity to an OVRFLO (reads pt/expiry from Pendle market automatically)
    /// @param ovrflo The OVRFLO contract address
    /// @param market The Pendle market address
    /// @param twapDuration TWAP duration in seconds
    /// @param feeBps Fee in basis points (max FEE_MAX_BPS)
    function addMarket(address ovrflo, address market, uint32 twapDuration, uint16 feeBps) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        _validateTwapBounds(twapDuration);
        if (feeBps > FEE_MAX_BPS) revert FeeTooHigh();

        {
            (bool increaseCardinalityRequired,, bool oldestObservationSatisfied) =
                IPendleOracle(oracle).getOracleState(market, twapDuration);
            if (increaseCardinalityRequired) revert OracleCardinalityRequired();
            if (!oldestObservationSatisfied) revert OracleNotReady();
        }

        OvrfloInfo memory info = ovrfloInfo[ovrflo];
        address pt;
        {
            address sy;
            (sy, pt,) = IPendleMarket(market).readTokens();
            if (IStandardizedYield(sy).yieldToken() != info.underlying) revert UnderlyingMismatch();
        }

        uint256 expiry = IPendleMarket(market).expiry();
        if (expiry <= block.timestamp) revert MarketExpired();
        OVRFLO(ovrflo).setSeriesApproved(market, pt, twapDuration, expiry, feeBps);

        isMarketApproved[ovrflo][market] = true;
        approvedMarketAt[ovrflo][approvedMarketCount[ovrflo]] = market;
        approvedMarketCount[ovrflo]++;
    }

    /// @notice Set the deposit limit for a market on an OVRFLO
    function setMarketDepositLimit(address ovrflo, address market, uint256 limit) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).setMarketDepositLimit(market, limit);
    }

    /// @notice Sweep excess PT tokens from an OVRFLO
    /// @dev `to` is trusted: the caller is the multisig (factory owner), so zero-address
    ///      validation is intentionally omitted per the project's stance of trusting what
    ///      the multisig already validates.
    function sweepExcessPt(address ovrflo, address ptToken, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).sweepExcessPt(ptToken, to);
    }

    /// @notice Sweep excess underlying from an OVRFLO column's reserve
    /// @dev `to` is trusted: the caller is the multisig (factory owner), so zero-address
    ///      validation is intentionally omitted per the project's stance of trusting what
    ///      the multisig already validates. The reserve is the write-once
    ///      `ovrfloToReserve` row admitted at `registerOvrflo`.
    function sweepExcessUnderlying(address ovrflo, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLOReserve(ovrfloToReserve[ovrflo]).sweepExcessUnderlying(to);
    }

    /// @notice Set the per-call flash-mint cap on a registered column's reserve
    /// @dev Timelock: `onlyOwner` on the factory, which is the timelocked Safe.
    ///      `max == 0` disables mint. The economic cap is `amount <= flashMintMax`.
    ///      The reserve reverts above `FLASH_MINT_MAX_CEILING`.
    /// @param ovrflo Registered vault
    /// @param max New cap
    function setReserveFlashMintMax(address ovrflo, uint256 max) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLOReserve(ovrfloToReserve[ovrflo]).setFlashMintMax(max);
        emit ReserveFlashMintMaxSet(ovrflo, max);
    }

    /// @notice Set the flash-mint fee in bps on a registered column's reserve
    /// @dev Timelock: `onlyOwner` on the factory, which is the timelocked Safe.
    ///      The reserve reverts above `FLASH_FEE_MAX_BPS` (9).
    /// @param ovrflo Registered vault
    /// @param bps New fee in basis points
    function setReserveFlashFeeBps(address ovrflo, uint16 bps) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLOReserve(ovrfloToReserve[ovrflo]).setFlashFeeBps(bps);
        emit ReserveFlashFeeBpsSet(ovrflo, bps);
    }

    /// @notice Increase Pendle oracle cardinality for a market (must be done before addMarket)
    /// @param market The Pendle market address
    /// @param twapDuration TWAP duration in seconds
    function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
        _validateTwapBounds(twapDuration);
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) =
            IPendleOracle(oracle).getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
    }

    /*//////////////////////////////////////////////////////////////
                  LENDING ADMIN (FACTORY-FORWARDED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the APR bounds on an OVRFLOLending (factory is the lending market's owner)
    /// @param lending The OVRFLOLending address
    /// @param aprMinBps_ New minimum APR in basis points
    /// @param aprMaxBps_ New maximum APR in basis points
    function setLendingAprBounds(address lending, uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setAprBounds(aprMinBps_, aprMaxBps_);
        emit LendingAprBoundsSet(lending, aprMinBps_, aprMaxBps_);
    }

    /// @notice Set the protocol fee on an OVRFLOLending
    /// @param lending The OVRFLOLending address
    /// @param feeBps_ New fee in basis points
    function setLendingFee(address lending, uint16 feeBps_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setFee(feeBps_);
        emit LendingFeeSet(lending, feeBps_);
    }

    /// @notice Set the fee treasury on an OVRFLOLending
    /// @param lending The OVRFLOLending address
    /// @param treasury_ New treasury address
    function setLendingTreasury(address lending, address treasury_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setTreasury(treasury_);
        emit LendingTreasurySet(lending, treasury_);
    }

    /// @notice Set a market's immutable APR tick spacing on an OVRFLOLending.
    /// @dev The multisig must verify during series onboarding that the underlying's
    ///      total supply is at most `2^54 * OVRFLOLending.UNIT()`. That operational
    ///      check intentionally remains offchain and is not duplicated here.
    /// @param lending The OVRFLOLending address.
    /// @param market The Pendle market whose APR ladder is configured.
    /// @param spacing Tick spacing in basis points; zero is invalid and a market is set once.
    function setLendingTickSpacing(address lending, address market, uint16 spacing) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setTickSpacing(market, spacing);
        emit LendingTickSpacingSet(lending, market, spacing);
    }

    /// @notice Set or clear the borrow router on an OVRFLOLending
    /// @dev Accepts zero to disable the on-behalf path and any nonzero Safe-selected
    ///      address. There is no identity or allowlist check. The Safe validates the
    ///      selected router off-chain. When the current slot is nonzero and differs from
    ///      `router_`, the outgoing router is appended once to `priorRouterAt(lending, ·)`
    ///      so Your OVRFLO can still find resting requests on it. `lending.router()` is
    ///      the only current pointer. After `replaceLending`, call this on the new market
    ///      once a request book bound to that market exists, and call
    ///      `setLendingRouter(oldLending, address(0))` so the old book stops filling.
    /// @param lending The OVRFLOLending address
    /// @param router_ New router; zero disables attribution
    function setLendingRouter(address lending, address router_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending market = OVRFLOLending(lending);
        address outgoing = market.router();
        if (outgoing != address(0) && outgoing != router_) _recordPriorRouter(lending, outgoing);
        market.setRouter(router_);
        emit LendingRouterSet(lending, router_);
    }

    /*//////////////////////////////////////////////////////////////
                     OVRFLO STREAM (FACTORY-FORWARDED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Admit the canonical OVRFLO Stream lockup. Callable once.
    /// @dev The factory is deployed before the lockup, so this cannot be a constructor
    ///      argument. Production and seed pass the factory as `initialAdmin` on the
    ///      lockup and the comptroller — never the Safe, never the deployer.
    /// @param stream Lockup address (`SablierV2LockupLinear`, identity OVRFLOStream).
    function setOvrfloStream(address stream) external onlyOwner {
        if (ovrfloStream != address(0)) revert OvrfloStreamAlreadySet();
        if (stream == address(0)) revert ZeroAddress();
        if (stream.code.length == 0) revert NoCode();

        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(stream);
        if (lockup.factory() != address(this)) revert StreamFactoryMismatch();
        if (lockup.admin() != address(this)) revert StreamAdminMismatch();
        if (IStreamComptrollerAdmin(lockup.comptroller()).admin() != address(this)) revert ComptrollerAdminMismatch();

        ovrfloStream = stream;
        emit OvrfloStreamSet(stream);
    }

    /// @notice Forward `setNFTDescriptor` to the canonical lockup. No vault argument.
    /// @dev One lockup serves every registered vault. A vault parameter would select
    ///      nothing while looking vault-scoped.
    /// @param descriptor OVRFLOStreamDescriptor (or any ISablierV2NFTDescriptor).
    function setStreamNFTDescriptor(address descriptor) external onlyOwner {
        if (ovrfloStream == address(0)) revert OvrfloStreamUnset();
        if (descriptor == address(0)) revert ZeroAddress();
        if (descriptor.code.length == 0) revert NoCode();
        ISablierV2LockupLinear(ovrfloStream).setNFTDescriptor(descriptor);
        emit StreamNFTDescriptorSet(descriptor);
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _requireKnownOvrflo(address ovrflo) internal view {
        if (ovrfloInfo[ovrflo].treasury == address(0)) revert UnknownOvrflo();
    }

    function _requireKnownLending(address lending) internal view {
        if (lendingToOvrflo[lending] == address(0)) revert UnknownLending();
    }

    /// @dev Append `router` to the lending's prior list once. History, not admission.
    function _recordPriorRouter(address lending, address router) internal {
        if (isPriorRouter[lending][router]) return;
        isPriorRouter[lending][router] = true;
        priorRouterAt[lending][priorRouterCount[lending]] = router;
        priorRouterCount[lending] += 1;
    }

    /// @dev Shared admission checks for `registerLending` and `replaceLending`.
    ///      Does not test whether the vault already has a market.
    function _verifyLendingCandidate(address lending) internal view returns (address ovrflo) {
        if (lending == address(0)) revert ZeroAddress();

        OVRFLOLending lendingMarket = OVRFLOLending(lending);
        ovrflo = lendingMarket.core();
        _requireKnownOvrflo(ovrflo);
        if (address(lendingMarket.factory()) != address(this)) revert FactoryMismatch();
        if (lendingMarket.owner() != address(this)) revert OwnerMismatch();
        if (address(lendingMarket.sablier()) != address(OVRFLO(ovrflo).sablierLL())) revert SablierMismatch();
        if (ovrfloStream == address(0)) revert OvrfloStreamUnset();
        if (address(lendingMarket.sablier()) != ovrfloStream) revert StreamNotCanonical();
    }

    function _validateTwapBounds(uint32 twapDuration) internal pure {
        if (twapDuration < MIN_TWAP_DURATION) revert TwapTooShort();
        if (twapDuration > MAX_TWAP_DURATION) revert TwapTooLong();
    }
}
