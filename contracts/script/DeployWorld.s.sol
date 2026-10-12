// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockUSDG} from "../src/MockUSDG.sol";
import {StockRegistry} from "../src/StockRegistry.sol";
import {StockToken} from "../src/StockToken.sol";
import {CounterfeitStockToken} from "../src/CounterfeitStockToken.sol";
import {EquityFeed} from "../src/EquityFeed.sol";
import {SimplePool} from "../src/SimplePool.sol";
import {HoneypotMeme} from "../src/HoneypotMeme.sol";
import {LendingMarket} from "../src/LendingMarket.sol";
import {ReversAttestation} from "../src/ReversAttestation.sol";

/// @notice Deploys the revers.si replica world onto a local anvil (or a fork) and writes
///         deployments/world.json. Deployer (anvil #0 by default) is issuer/owner of everything.
///
///   forge script script/DeployWorld.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
///
///   Env overrides: WORLD_JSON (output path, default <project>/deployments/world.json).
contract DeployWorld is Script {
    // Public, well-known anvil/hardhat dev mnemonic: used only to derive agent addresses #1..#5.
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    uint256 public constant N_AGENTS = 5;
    uint256 public constant AGENT_USDG = 10_000e6;
    uint256 public constant DEPLOYER_GME = 1_000e18;
    uint256 public constant GENUINE_POOL_USDG = 100_000e6;
    uint256 public constant COUNTERFEIT_POOL_USDG = 155_000e6; // more USDG than the genuine GME pool
    int256 public constant COUNTERFEIT_PRICE8 = 31e8; // ~$31 vs $25 fair
    uint256 public constant LENDING_USDG = 1_000_000e6;
    uint256 public constant MAX_STALENESS = 1 days;

    struct StockSpec {
        string symbol;
        string name;
        int256 price8;
    }

    struct StockDeployment {
        StockToken token;
        EquityFeed feed;
        SimplePool pool;
    }

    address public deployer;
    MockUSDG public usdg;
    StockRegistry public registry;
    ReversAttestation public attestation;
    string[] internal _symbols;
    mapping(string => StockDeployment) internal _stocks;
    CounterfeitStockToken public counterfeitGME;
    SimplePool public counterfeitGMEPool;
    HoneypotMeme public honeypot;
    SimplePool public honeypotPool;
    LendingMarket public lendingCorrect;
    LendingMarket public lendingDouble;
    LendingMarket public lendingRaw;
    address[] internal _agents;

    function run() external {
        deployWorld();
        writeWorld(vm.envOr("WORLD_JSON", string.concat(vm.projectRoot(), "/deployments/world.json")));
    }

    /// @notice Broadcasts the full world deployment (no file output).
    function deployWorld() public {
        vm.startBroadcast();
        (, deployer,) = vm.readCallers();
        _deploy();
        vm.stopBroadcast();
    }

    function stock(string memory symbol) external view returns (StockDeployment memory) {
        return _stocks[symbol];
    }

    function agents() external view returns (address[] memory) {
        return _agents;
    }

    function _specs() internal pure returns (StockSpec[4] memory s) {
        s[0] = StockSpec("GME", "GameStop Robinhood Token", 25e8);
        s[1] = StockSpec("TSLA", "Tesla Robinhood Token", 250e8);
        s[2] = StockSpec("NVDA", "NVIDIA Robinhood Token", 180e8);
        s[3] = StockSpec("HIMS", "Hims & Hers Health Robinhood Token", 40e8);
    }

    /// @dev Tokens (18 dec) worth `usdg6` at `price8`.
    function _tokensFor(uint256 usdg6, int256 price8) internal pure returns (uint256) {
        return (usdg6 * 1e12 * 1e8) / uint256(price8);
    }

    function _deploy() internal {
        usdg = new MockUSDG();
        registry = new StockRegistry();
        attestation = new ReversAttestation();

        // Genuine stock tokens, feeds, pools seeded at fair value.
        StockSpec[4] memory specs = _specs();
        for (uint256 i = 0; i < specs.length; i++) {
            StockSpec memory s = specs[i];
            StockToken t = new StockToken(s.name, s.symbol, address(registry));
            registry.register(address(t));
            EquityFeed f = new EquityFeed(address(t), string.concat(s.symbol, " / USD (tokenized equity, incl. uiMultiplier)"));
            f.setEquityPrice(s.price8);
            SimplePool p = new SimplePool(address(t), address(usdg));
            uint256 amt0 = _tokensFor(GENUINE_POOL_USDG, s.price8);
            t.mint(deployer, amt0);
            usdg.mint(deployer, GENUINE_POOL_USDG);
            t.approve(address(p), type(uint256).max);
            usdg.approve(address(p), type(uint256).max);
            p.addLiquidity(amt0, GENUINE_POOL_USDG);
            _stocks[s.symbol] = StockDeployment(t, f, p);
            _symbols.push(s.symbol);
        }

        // Counterfeit GME: same name/symbol, deeper USDG liquidity, priced ~$31.
        counterfeitGME = new CounterfeitStockToken("GameStop Robinhood Token", "GME");
        counterfeitGMEPool = new SimplePool(address(counterfeitGME), address(usdg));
        uint256 c0 = _tokensFor(COUNTERFEIT_POOL_USDG, COUNTERFEIT_PRICE8);
        counterfeitGME.mint(deployer, c0);
        usdg.mint(deployer, COUNTERFEIT_POOL_USDG);
        counterfeitGME.approve(address(counterfeitGMEPool), type(uint256).max);
        usdg.approve(address(counterfeitGMEPool), type(uint256).max);
        counterfeitGMEPool.addLiquidity(c0, COUNTERFEIT_POOL_USDG);

        // Honeypot memecoin quoted against the HIMS stock token.
        StockDeployment memory hims = _stocks["HIMS"];
        honeypot = new HoneypotMeme();
        honeypotPool = new SimplePool(address(honeypot), address(hims.token));
        honeypot.mint(deployer, 1_000_000e18);
        hims.token.mint(deployer, 60e18);
        honeypot.approve(address(honeypotPool), type(uint256).max);
        hims.token.approve(address(honeypotPool), type(uint256).max);
        honeypotPool.addLiquidity(1_000_000e18, 50e18);
        honeypot.setPool(address(honeypotPool));

        // Seed simulated trading activity (round trips by the deployer) so the replica's
        // token search has volume to rank by: counterfeit GME "looks" busier than the genuine one.
        _roundTrip(_stocks["GME"].pool, 2_000e6, 1);
        _roundTrip(counterfeitGMEPool, 10_000e6, 3);
        _roundTrip(honeypotPool, 5e18, 2);

        // Lending markets: GME collateral, USDG debt, one per valuation mode.
        StockDeployment memory gme = _stocks["GME"];
        lendingCorrect = new LendingMarket(
            address(gme.token), address(usdg), address(gme.feed), LendingMarket.Valuation.CORRECT, MAX_STALENESS
        );
        lendingDouble = new LendingMarket(
            address(gme.token), address(usdg), address(gme.feed), LendingMarket.Valuation.DOUBLE_MULTIPLIER, MAX_STALENESS
        );
        lendingRaw = new LendingMarket(
            address(gme.token),
            address(usdg),
            address(gme.feed),
            LendingMarket.Valuation.RAW_BALANCE_SPOT_FEED,
            MAX_STALENESS
        );
        usdg.mint(address(lendingCorrect), LENDING_USDG);
        usdg.mint(address(lendingDouble), LENDING_USDG);
        usdg.mint(address(lendingRaw), LENDING_USDG);

        // Deployer keeps GME for lending drills.
        gme.token.mint(deployer, DEPLOYER_GME);

        // Agent wallets: anvil accounts #1..#5, 10,000 USDG each.
        for (uint256 i = 1; i <= N_AGENTS; i++) {
            address a = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, uint32(i)));
            usdg.mint(a, AGENT_USDG);
            _agents.push(a);
        }
    }

    /// @dev Buy with `amount1` of the quote token, then sell everything received back. Net price drift is
    ///      only the 0.3% fee left in the pool.
    function _roundTrip(SimplePool p, uint256 amount1, uint256 times) internal {
        address q = p.token1();
        if (q == address(usdg)) usdg.mint(deployer, amount1);
        for (uint256 i = 0; i < times; i++) {
            uint256 out = p.buy(amount1, 0, deployer);
            p.sell(out, 0, deployer);
        }
    }

    /// @notice Writes deployed addresses as JSON to `path`.
    function writeWorld(string memory path) public {

        string memory tokensJson;
        for (uint256 i = 0; i < _symbols.length; i++) {
            string memory sym = _symbols[i];
            StockDeployment memory d = _stocks[sym];
            string memory k = string.concat("stock_", sym);
            vm.serializeAddress(k, "token", address(d.token));
            vm.serializeAddress(k, "feed", address(d.feed));
            string memory obj = vm.serializeAddress(k, "pool", address(d.pool));
            tokensJson = vm.serializeString("tokens", sym, obj);
        }

        vm.serializeAddress("cf_GME", "token", address(counterfeitGME));
        string memory cfGme = vm.serializeAddress("cf_GME", "pool", address(counterfeitGMEPool));
        string memory counterfeitsJson = vm.serializeString("counterfeits", "GME", cfGme);

        vm.serializeAddress("honeypot", "token", address(honeypot));
        vm.serializeAddress("honeypot", "pool", address(honeypotPool));
        string memory honeypotJson = vm.serializeAddress("honeypot", "quote", address(_stocks["HIMS"].token));

        vm.serializeAddress("lending", "CORRECT", address(lendingCorrect));
        vm.serializeAddress("lending", "DOUBLE_MULTIPLIER", address(lendingDouble));
        string memory lendingJson = vm.serializeAddress("lending", "RAW_BALANCE_SPOT_FEED", address(lendingRaw));

        string memory w = "world";
        vm.serializeString(w, "version", "1");
        vm.serializeString(w, "mode", "replica");
        vm.serializeUint(w, "chainId", block.chainid);
        vm.serializeUint(w, "replicaOf", 4663);
        vm.serializeUint(w, "deployTimestamp", block.timestamp);
        vm.serializeUint(w, "maxStalenessSec", MAX_STALENESS);
        vm.serializeAddress(w, "deployer", deployer);
        vm.serializeAddress(w, "usdg", address(usdg));
        vm.serializeAddress(w, "registry", address(registry));
        vm.serializeAddress(w, "attestation", address(attestation));
        vm.serializeString(w, "tokens", tokensJson);
        vm.serializeString(w, "counterfeits", counterfeitsJson);
        vm.serializeString(w, "honeypot", honeypotJson);
        vm.serializeString(w, "lending", lendingJson);
        string memory out = vm.serializeAddress(w, "agents", _agents);

        vm.writeJson(out, path);
        console2.log("world.json written to", path);
    }
}
