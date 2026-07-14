// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Actor} from "./Actor.sol";
import {Clamp} from "./utils/Clamp.sol";
import {vm} from "./utils/Hevm.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {StringUtils} from "./utils/StringUtils.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {OVRFLOLENDING} from "../../src/OVRFLOLENDING.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {MockSablier} from "./mocks/MockSablier.sol";
import {MockPendleOracle} from "./mocks/MockPendleOracle.sol";
import {MockPendleMarket} from "./mocks/MockPendleMarket.sol";
import {MockStandardizedYield} from "./mocks/MockStandardizedYield.sol";

/// @notice Base contract with state variables and setup functions
abstract contract Base is StringUtils, Clamp {
    string[] internal ACTOR_LABELS = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace"];
    uint256 internal constant BLOCK_INTERVAL = 12 seconds;
    uint256 internal constant INITIAL_ETH_BALANCE = 1_000 ether;

    // ―――――――――――――――――――――――――― Ghosts ――――――――――――――――――――――――――

    struct Ghosts {
        // ID counter tracking (GL-15)
        uint256 ghost_lastNextLiquidityId;
        uint256 ghost_lastNextSaleListingId;
        uint256 ghost_lastNextLoanId;
        uint256 ghost_lastNextPoolId;
        // Deposit tracking (SP-07, GL-51, SP-63)
        uint256 ghost_lastToUser;
        uint256 ghost_lastDepositPtAmount;
        // Entity ID tracking (SP-*)
        uint256 ghost_lastPoolId;
        uint256 ghost_lastLoanId;
        uint256 ghost_lastLiquidityId;
        uint256 ghost_lastListingId;
        // Stream tracking (for snapshots)
        uint256 ghost_lastStreamId;
        // Oracle rate tracking (SP-63 rate-stability gate)
        uint256 ghost_lastOracleRate;
    }

    Ghosts internal ghosts;

    // Mapping ghosts from the property plan
    mapping(address => uint256) internal ghost_actorStartValue;
    address public mockFlashBorrowerAddr;

    // Monotonicity ghost mappings (section 6 of plan)
    mapping(uint256 => uint128) internal ghost_loanDrawnSnapshot;
    mapping(uint256 => uint128) internal ghost_loanRepaidSnapshot;
    mapping(uint256 => mapping(address => uint128)) internal ghost_poolReceivedSnapshot;

    // One-way flag tracking (GL-11, GL-12, GL-13)
    mapping(uint256 => bool) internal ghost_liquidityActiveSnapshot;
    mapping(uint256 => bool) internal ghost_listingActiveSnapshot;
    mapping(uint256 => bool) internal ghost_loanClosedSnapshot;
    mapping(uint256 => bool) internal ghost_liquiditySeen;
    mapping(uint256 => bool) internal ghost_listingSeen;
    mapping(uint256 => bool) internal ghost_loanSeen;

    // Immutability tracking (GL-33..GL-42)
    mapping(uint256 => uint128) internal ghost_loanObligationInit;
    mapping(uint256 => uint256) internal ghost_loanStreamIdInit;
    mapping(uint256 => address) internal ghost_loanBorrowerInit;
    mapping(uint256 => address) internal ghost_loanLenderInit;
    mapping(uint256 => address) internal ghost_liquidityMakerInit;
    mapping(uint256 => uint16) internal ghost_liquidityAprBpsInit;
    mapping(uint256 => uint16) internal ghost_listingFeeBpsInit;
    mapping(uint256 => bool) internal ghost_listingFeeRecorded;
    mapping(uint256 => uint128) internal ghost_poolTotalContributedInit;
    mapping(uint256 => uint128) internal ghost_poolTotalObligationInit;
    mapping(uint256 => mapping(address => uint128)) internal ghost_poolContributionsInit;
    mapping(address => address) internal ghost_seriesPtTokenInit;
    mapping(address => uint256) internal ghost_seriesExpiryInit;
    mapping(address => uint16) internal ghost_seriesFeeBpsInit;
    mapping(address => address) internal ghost_ptToMarketInit;

    // Factory counter tracking (GL-19, GL-20, GL-21)
    uint256 internal ghost_lastOvrfloCount;
    uint256 internal ghost_lastLendingCount;
    uint256 internal ghost_lastApprovedMarketCount;

    // Wave 2 ghosts (GL-65, GL-70, GL-71, GL-81, SP-99)
    mapping(uint256 => uint128) internal ghost_liquidityCapacitySnapshot;
    mapping(uint256 => bool) internal ghost_liquidityCapacitySeen;
    mapping(uint256 => uint128) internal ghost_liquidityInitialCapacity;
    mapping(uint256 => uint128) internal ghost_loanStreamWithdrawnAtCreation;
    mapping(uint256 => uint128) internal ghost_loanStreamWithdrawnAtClose;
    uint256 internal ghost_lastSaleGrossPrice;
    uint256 internal ghost_lastSaleFeeAmount;
    uint256 internal ghost_lastSaleNetToSeller;

    // ―――――――――――――――――――――――――― Actors ――――――――――――――――――――――――――

    address[] internal actors;
    address internal actor;
    address internal admin;

    modifier asActor() virtual {
        vm.startPrank(actor);
        _;
        vm.stopPrank();
    }

    modifier asAdmin() virtual {
        vm.startPrank(admin);
        _;
        vm.stopPrank();
    }

    // ―――――――――――――――――――――――― Contracts ―――――――――――――――――――――――――

    OVRFLOFactory public factory;
    OVRFLO public vault;
    OVRFLOToken public ovrfloToken;
    OVRFLOLENDING public lending;
    MockERC20 public underlying;
    MockERC20 public ptToken;
    MockPendleOracle public mockOracle;
    MockPendleMarket public mockMarket;
    MockStandardizedYield public mockSY;
    MockSablier public mockSablier;

    address public treasury;
    address public market;
    address constant SABLIER_ADDR = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    uint32 constant TWAP_DURATION = 900; // 15 minutes
    uint256 constant INITIAL_TOKEN_AMOUNT = 1_000_000 ether;

    // ―――――――――――――――――――――――――― Setup ―――――――――――――――――――――――――――

    function setup() internal {
        // 1. Deploy mock tokens
        underlying = new MockERC20(address(this), 0, "Underlying", "UND", 18);
        ptToken = new MockERC20(address(this), 0, "Pendle PT", "PPT", 18);

        // 2. Deploy mock infrastructure
        mockOracle = new MockPendleOracle();
        mockSY = new MockStandardizedYield(address(underlying));
        mockMarket =
            new MockPendleMarket(block.timestamp + 1000 * 365 days, address(mockSY), address(ptToken), address(0));
        mockSablier = new MockSablier();
        market = address(mockMarket);

        // 3. Place mock Sablier at the hardcoded address OVRFLO expects
        vm.etch(SABLIER_ADDR, address(mockSablier).code);

        // 4. Deploy factory (admin = address(this))
        factory = new OVRFLOFactory(address(this), address(mockOracle));

        // 5. Configure and deploy vault
        treasury = address(this);
        vm.label(treasury, "Treasury");
        factory.configureDeployment(treasury, address(underlying), "TEST", "TST");
        (address vaultAddr, address tokenAddr) = factory.deploy();
        vault = OVRFLO(vaultAddr);
        ovrfloToken = OVRFLOToken(tokenAddr);
        vm.label(vaultAddr, "OVRFLO Vault");
        vm.label(tokenAddr, "ovrfloToken");

        // 6. Add market (15 min TWAP, 0.1% deposit fee)
        factory.prepareOracle(market, TWAP_DURATION);
        factory.addMarket(vaultAddr, market, TWAP_DURATION, 10);
        vm.label(market, "MockPendleMarket");

        // 7. Deploy lending
        address lendingAddr = factory.deployLending(vaultAddr);
        lending = OVRFLOLENDING(lendingAddr);
        vm.label(lendingAddr, "OVRFLOLENDING");

        // 8. Configure limits and bounds
        factory.setMarketDepositLimit(vaultAddr, market, type(uint256).max);
        factory.setLendingAprBounds(lendingAddr, 0, 10_000); // 0% to 100% APR
        factory.setLendingFee(lendingAddr, 0); // 0% lending fee

        // Fund this contract for Actor creation (Medusa doesn't fund during construction)
        vm.deal(address(this), INITIAL_ETH_BALANCE * ACTOR_LABELS.length);

        setupActors();
    }

    function setupActors() internal {
        admin = address(this);
        vm.label(admin, "Admin");

        for (uint256 i; i < ACTOR_LABELS.length; i++) {
            address _actor = address(new Actor{value: INITIAL_ETH_BALANCE}());
            actors.push(_actor);
            if (ACTOR_LABELS.length > i) {
                vm.label(_actor, ACTOR_LABELS[i]);
            }
            // Mint tokens to actor
            underlying.deal(_actor, INITIAL_TOKEN_AMOUNT);
            ptToken.deal(_actor, INITIAL_TOKEN_AMOUNT);
            // Set approvals: vault (deposit + wrap), lending (supplyLiquidity + buyListing + repayLoan)
            // Also approve lending for Sablier NFT transfers (sellStreamToLiquidity, postSaleListing,
            // createBorrowerLoanPool all call sablier.transferFrom from msg.sender).
            vm.startPrank(_actor);
            ptToken.approve(address(vault), type(uint256).max);
            underlying.approve(address(vault), type(uint256).max);
            underlying.approve(address(lending), type(uint256).max);
            ovrfloToken.approve(address(lending), type(uint256).max);
            MockSablier(SABLIER_ADDR).setApprovalForAll(address(lending), true);
            vm.stopPrank();
            ghost_actorStartValue[_actor] = INITIAL_TOKEN_AMOUNT * 2; // underlying + PT
        }
        actor = actors[0];
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    // Maps an arbitrary address to an actor address
    function toActor(address addy) internal view returns (address) {
        return actors[uint256(uint160(addy)) % actors.length];
    }

    // Sums the ERC-20 token balances of all actors for a given token
    function sumActorsERC20Balances(address _token) internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            bytes memory data = abi.encodeWithSignature("balanceOf(address)", actors[i]);
            (bool success, bytes memory result) = _token.staticcall(data);
            require(success, "sumActorsERC20Balances: failed to get balance");
            sumOfBalances += abi.decode(result, (uint256));
        }
    }

    function skipTime(uint256 time) internal {
        uint256 blocks = (time + BLOCK_INTERVAL - 1) / BLOCK_INTERVAL;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + time);
    }
}
