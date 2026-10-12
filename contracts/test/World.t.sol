// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../src/MockUSDG.sol";
import {StockRegistry} from "../src/StockRegistry.sol";
import {StockToken} from "../src/StockToken.sol";
import {CounterfeitStockToken} from "../src/CounterfeitStockToken.sol";
import {EquityFeed} from "../src/EquityFeed.sol";
import {SimplePool} from "../src/SimplePool.sol";
import {HoneypotMeme} from "../src/HoneypotMeme.sol";
import {LendingMarket} from "../src/LendingMarket.sol";
import {ReversAttestation} from "../src/ReversAttestation.sol";

contract WorldTest is Test {
    MockUSDG usdg;
    StockRegistry registry;
    StockToken gme;
    EquityFeed feed;
    SimplePool pool;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt);

    function setUp() public {
        vm.warp(1_760_000_000);
        usdg = new MockUSDG();
        registry = new StockRegistry();
        gme = new StockToken("GameStop Robinhood Token", "GME", address(registry));
        registry.register(address(gme));
        feed = new EquityFeed(address(gme), "GME / USD");
        feed.setEquityPrice(25e8);
        pool = new SimplePool(address(gme), address(usdg));
        gme.mint(address(this), 4_000e18);
        usdg.mint(address(this), 100_000e6);
        gme.approve(address(pool), type(uint256).max);
        usdg.approve(address(pool), type(uint256).max);
        pool.addLiquidity(4_000e18, 100_000e6);
        usdg.mint(alice, 10_000e6);
    }

    // ---------------- registry ----------------

    function test_registry_basics() public {
        assertTrue(registry.isRegistered(address(gme)));
        address[] memory t = registry.tokens();
        assertEq(t.length, 1);
        assertEq(t[0], address(gme));
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.AlreadyRegistered.selector, address(gme)));
        registry.register(address(gme));
        vm.prank(alice);
        vm.expectRevert(StockRegistry.NotOwner.selector);
        registry.pauseAll();
    }

    // ---------------- stock token: multiplier ----------------

    function test_multiplier_defaultsToOne() public view {
        assertEq(gme.uiMultiplier(), 1e18);
        assertEq(gme.newUIMultiplier(), 1e18);
        assertEq(gme.registry(), address(registry));
        assertEq(gme.decimals(), 18);
    }

    function test_multiplier_switchesOverAtEffectiveAt() public {
        uint256 eff = block.timestamp + 1 hours;
        vm.expectEmit(address(gme));
        emit UIMultiplierUpdated(1e18, 4e18, eff);
        gme.updateMultiplier(4e18, eff);
        assertEq(gme.uiMultiplier(), 1e18, "old multiplier before effectiveAt");
        assertEq(gme.newUIMultiplier(), 4e18);
        assertEq(gme.effectiveAt(), eff);
        vm.warp(eff - 1);
        assertEq(gme.uiMultiplier(), 1e18);
        vm.warp(eff);
        assertEq(gme.uiMultiplier(), 4e18, "new multiplier at effectiveAt");
        // A second update rolls the effective one into "old".
        vm.warp(eff + 10);
        gme.updateMultiplier(8e18, block.timestamp + 100);
        assertEq(gme.uiMultiplier(), 4e18);
        vm.warp(block.timestamp + 100);
        assertEq(gme.uiMultiplier(), 8e18);
    }

    function test_multiplier_onlyIssuer() public {
        vm.prank(alice);
        vm.expectRevert(StockToken.NotIssuer.selector);
        gme.updateMultiplier(4e18, block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(StockToken.NotIssuer.selector);
        gme.mint(alice, 1);
    }

    // ---------------- stock token: pause / blocklist ----------------

    function test_globalPause_blocksTransfers() public {
        gme.mint(alice, 10e18);
        registry.pauseAll();
        vm.prank(alice);
        vm.expectRevert(StockToken.GloballyPaused.selector);
        gme.transfer(bob, 1e18);
        registry.unpauseAll();
        vm.prank(alice);
        gme.transfer(bob, 1e18);
        assertEq(gme.balanceOf(bob), 1e18);
    }

    function test_blocklist_blocksSenderAndRecipient() public {
        gme.mint(alice, 10e18);
        registry.setBlocklisted(bob, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockToken.Blocklisted.selector, bob));
        gme.transfer(bob, 1e18);
        registry.setBlocklisted(bob, false);
        registry.setBlocklisted(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockToken.Blocklisted.selector, alice));
        gme.transfer(bob, 1e18);
    }

    function test_globalPause_makesPoolSwapsRevert() public {
        vm.startPrank(alice);
        usdg.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        registry.pauseAll();
        vm.prank(alice);
        vm.expectRevert(StockToken.GloballyPaused.selector);
        pool.buy(100e6, 0, alice);
    }

    // ---------------- counterfeit ----------------

    function test_counterfeit_looksIdenticalButIsNotRegistered() public {
        CounterfeitStockToken fake = new CounterfeitStockToken("GameStop Robinhood Token", "GME");
        assertEq(fake.name(), gme.name());
        assertEq(fake.symbol(), gme.symbol());
        assertEq(fake.uiMultiplier(), 1e18);
        assertFalse(registry.isRegistered(address(fake)));
        // Permissionless mint, and it keeps transferring during a global pause.
        vm.prank(alice);
        fake.mint(alice, 5e18);
        registry.pauseAll();
        vm.prank(alice);
        fake.transfer(bob, 1e18);
        assertEq(fake.balanceOf(bob), 1e18);
    }

    // ---------------- feed ----------------

    function test_feed_includesMultiplier() public {
        (uint80 r, int256 a,, uint256 upd, uint80 ans) = feed.latestRoundData();
        assertEq(feed.decimals(), 8);
        assertEq(feed.token(), address(gme));
        assertEq(r, 1);
        assertEq(ans, 1);
        assertEq(a, 25e8);
        assertEq(upd, block.timestamp);

        // 4-for-1 split: equity price quartered, feed answer per raw token unchanged.
        gme.updateMultiplier(4e18, block.timestamp + 1 hours);
        vm.warp(block.timestamp + 1 hours);
        feed.setEquityPrice(625e6); // $6.25
        (r, a,,,) = feed.latestRoundData();
        assertEq(r, 2);
        assertEq(a, 25e8);
        assertEq(feed.equityPrice(), 625e6);
    }

    function test_feed_pauseBlocksUpdates() public {
        feed.pauseOracle();
        assertTrue(feed.oraclePaused());
        vm.expectRevert(EquityFeed.OracleIsPaused.selector);
        feed.setEquityPrice(30e8);
        feed.unpauseOracle();
        feed.setEquityPrice(30e8);
        assertEq(feed.latestAnswer(), 30e8);
    }

    function test_feed_setPriceAtPastTimestamp() public {
        uint256 friday = block.timestamp - 46 hours;
        feed.setEquityPriceAt(26e8, friday);
        (,,, uint256 upd,) = feed.latestRoundData();
        assertEq(upd, friday);
        vm.expectRevert(EquityFeed.InvalidTimestamp.selector);
        feed.setEquityPriceAt(26e8, block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(EquityFeed.NotOwner.selector);
        feed.setEquityPrice(1e8);
    }

    // ---------------- pool ----------------

    function test_pool_spotAndQuotes() public {
        assertEq(pool.token0(), address(gme));
        assertEq(pool.token1(), address(usdg));
        assertEq(pool.spotPriceUsd8(), 25e8);
        uint256 q = pool.quoteBuy(100e6);
        // ~4 GME minus fee and price impact
        assertGt(q, 3.98e18);
        assertLt(q, 4e18);

        vm.startPrank(alice);
        usdg.approve(address(pool), type(uint256).max);
        (uint256 r0, uint256 r1) = pool.getReserves();
        uint256 kBefore = r0 * r1;
        uint256 out = pool.buy(100e6, q, alice);
        assertEq(out, q);
        assertEq(gme.balanceOf(alice), q);
        (r0, r1) = pool.getReserves();
        assertGe(r0 * r1, kBefore, "k never decreases");
        assertEq(pool.cumulativeVolume1(), 100e6);

        uint256 sq = pool.quoteSell(out);
        gme.approve(address(pool), type(uint256).max);
        uint256 back = pool.sell(out, sq, alice);
        assertEq(back, sq);
        assertLt(back, 100e6, "round trip loses fees");
        vm.stopPrank();
    }

    function test_pool_slippageReverts() public {
        vm.startPrank(alice);
        usdg.approve(address(pool), type(uint256).max);
        uint256 q = pool.quoteBuy(100e6);
        vm.expectRevert(abi.encodeWithSelector(SimplePool.Slippage.selector, q, q + 1));
        pool.buy(100e6, q + 1, alice);
        vm.stopPrank();
    }

    function test_pool_onlyOwnerAddsLiquidity() public {
        vm.prank(alice);
        vm.expectRevert(SimplePool.NotOwner.selector);
        pool.addLiquidity(1, 1);
    }

    function testFuzz_pool_buyMatchesQuote(uint256 usdIn) public {
        usdIn = bound(usdIn, 1, 10_000e6);
        vm.startPrank(alice);
        usdg.approve(address(pool), type(uint256).max);
        uint256 q = pool.quoteBuy(usdIn);
        uint256 out = pool.buy(usdIn, 0, alice);
        vm.stopPrank();
        assertEq(out, q);
        // never pays less than spot-implied price (fee + impact)
        assertLe(out, (usdIn * 1e12 * 1e8) / 25e8);
    }

    // ---------------- honeypot ----------------

    function test_honeypot_buysWorkSellsRevert() public {
        HoneypotMeme meme = new HoneypotMeme();
        assertEq(meme.symbol(), "BONER");
        SimplePool hp = new SimplePool(address(meme), address(gme));
        meme.mint(address(this), 1_000_000e18);
        gme.mint(address(this), 50e18);
        meme.approve(address(hp), type(uint256).max);
        gme.approve(address(hp), type(uint256).max);
        hp.addLiquidity(1_000_000e18, 50e18);
        meme.setPool(address(hp));

        gme.mint(alice, 1e18);
        vm.startPrank(alice);
        gme.approve(address(hp), type(uint256).max);
        uint256 got = hp.buy(1e18, 0, alice);
        assertGt(got, 0);
        assertGt(hp.quoteSell(got), 0, "quote looks fine");
        meme.approve(address(hp), type(uint256).max);
        vm.expectRevert(HoneypotMeme.TradingRestricted.selector);
        hp.sell(got, 0, alice);
        vm.stopPrank();

        // owner can exit
        gme.mint(address(this), 1e18);
        uint256 ownerOut = hp.buy(1e18, 0, address(this));
        hp.sell(ownerOut, 0, address(this));
    }

    // ---------------- lending ----------------

    function _market(LendingMarket.Valuation v) internal returns (LendingMarket m) {
        m = new LendingMarket(address(gme), address(usdg), address(feed), v, 1 days);
        usdg.mint(address(m), 1_000_000e6);
    }

    function _open(LendingMarket m) internal {
        gme.mint(alice, 10e18);
        vm.startPrank(alice);
        gme.approve(address(m), type(uint256).max);
        m.deposit(10e18);
        m.borrow(125e6); // 50% LTV of $250
        vm.stopPrank();
    }

    function _split4() internal {
        gme.updateMultiplier(4e18, block.timestamp + 1 hours);
        vm.warp(block.timestamp + 1 hours);
        feed.setEquityPrice(625e6);
    }

    function test_lending_baselineAllAgree() public {
        LendingMarket a = _market(LendingMarket.Valuation.CORRECT);
        LendingMarket b = _market(LendingMarket.Valuation.DOUBLE_MULTIPLIER);
        LendingMarket c = _market(LendingMarket.Valuation.RAW_BALANCE_SPOT_FEED);
        _open(a);
        _open(b);
        _open(c);
        assertEq(a.collateralValueUsd8(alice), 250e8);
        assertEq(b.collateralValueUsd8(alice), 250e8);
        assertEq(c.collateralValueUsd8(alice), 250e8);
        assertEq(a.healthFactor(alice), 1.6e18);
        assertEq(b.healthFactor(alice), 1.6e18);
        assertEq(c.healthFactor(alice), 1.6e18);
        assertEq(usdg.balanceOf(alice), 10_000e6 + 375e6);
    }

    function test_lending_split_correctUnchanged_bugsDiverge() public {
        LendingMarket a = _market(LendingMarket.Valuation.CORRECT);
        LendingMarket b = _market(LendingMarket.Valuation.DOUBLE_MULTIPLIER);
        LendingMarket c = _market(LendingMarket.Valuation.RAW_BALANCE_SPOT_FEED);
        _open(a);
        _open(b);
        _open(c);
        _split4();

        assertEq(a.collateralValueUsd8(alice), 250e8, "correct: unchanged");
        assertEq(a.healthFactor(alice), 1.6e18);
        assertFalse(a.isLiquidatable(alice));

        assertEq(b.collateralValueUsd8(alice), 1000e8, "double multiplier: 4x inflated");
        assertEq(b.healthFactor(alice), 6.4e18);
        assertFalse(b.isLiquidatable(alice));

        assertEq(c.collateralValueUsd8(alice), 62.5e8, "raw balance: looks like a 75% loss");
        assertEq(c.healthFactor(alice), 0.4e18);
        assertTrue(c.isLiquidatable(alice), "wrongful liquidation");
    }

    function test_lending_staleAndPausedFeed() public {
        LendingMarket a = _market(LendingMarket.Valuation.CORRECT);
        LendingMarket b = _market(LendingMarket.Valuation.DOUBLE_MULTIPLIER);
        LendingMarket c = _market(LendingMarket.Valuation.RAW_BALANCE_SPOT_FEED);
        _open(a);
        _open(b);
        _open(c);

        // Weekend: feed ~46h old.
        vm.warp(block.timestamp + 46 hours);
        vm.expectRevert(LendingMarket.StalePrice.selector);
        a.healthFactor(alice);
        vm.expectRevert(LendingMarket.StalePrice.selector);
        a.isLiquidatable(alice);
        assertEq(b.healthFactor(alice), 1.6e18, "buggy variant happily uses stale price");
        assertEq(c.healthFactor(alice), 1.6e18);

        // Fresh again, then oracle paused.
        feed.setEquityPrice(25e8);
        assertEq(a.healthFactor(alice), 1.6e18);
        feed.pauseOracle();
        vm.expectRevert(LendingMarket.StalePrice.selector);
        a.healthFactor(alice);
        assertEq(b.healthFactor(alice), 1.6e18);
    }

    function test_lending_borrowBeyondLimitReverts() public {
        LendingMarket a = _market(LendingMarket.Valuation.CORRECT);
        gme.mint(alice, 10e18);
        vm.startPrank(alice);
        gme.approve(address(a), type(uint256).max);
        a.deposit(10e18);
        vm.expectRevert(abi.encodeWithSelector(LendingMarket.Unhealthy.selector, uint256(992063492063492063)));
        a.borrow(201.6e6);
        a.borrow(200e6); // exactly 80% -> hf 1.0
        assertEq(a.healthFactor(alice), 1e18);
        usdg.approve(address(a), type(uint256).max);
        a.repay(100e6);
        assertEq(a.debtOf(alice), 100e6);
        vm.stopPrank();
        assertEq(a.healthFactor(bob), type(uint256).max);
    }

    // ---------------- attestation ----------------

    event Attested(address indexed attester, bytes32 indexed runHash, string targetId, uint16 score, string uri);

    function test_attestation() public {
        ReversAttestation att = new ReversAttestation();
        bytes32 h = keccak256("run-1");
        vm.expectEmit(address(att));
        emit Attested(alice, h, "agent:naive-search", 40, "ipfs://x");
        vm.prank(alice);
        att.attest(h, "agent:naive-search", 40, "ipfs://x");
        (bytes32 rh, uint16 s, uint64 at) = att.latest("agent:naive-search");
        assertEq(rh, h);
        assertEq(s, 40);
        assertEq(at, block.timestamp);
        (rh, s, at) = att.latest("unknown");
        assertEq(rh, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ReversAttestation.ScoreOutOfRange.selector, uint16(101)));
        att.attest(h, "x", 101, "");
    }
}
