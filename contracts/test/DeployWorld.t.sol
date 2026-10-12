// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployWorld} from "../script/DeployWorld.s.sol";
import {SimplePool} from "../src/SimplePool.sol";
import {StockToken} from "../src/StockToken.sol";
import {LendingMarket} from "../src/LendingMarket.sol";
import {HoneypotMeme} from "../src/HoneypotMeme.sol";

contract DeployWorldTest is Test {
    DeployWorld script;
    string path;

    function setUp() public {
        path = string.concat(vm.projectRoot(), "/deployments/world.test.json");
        script = new DeployWorld();
        script.deployWorld();
    }

    function test_worldJsonMatchesDeployment() public {
        script.writeWorld(path);
        string memory json = vm.readFile(path);
        assertEq(vm.parseJsonAddress(json, ".usdg"), address(script.usdg()));
        assertEq(vm.parseJsonAddress(json, ".registry"), address(script.registry()));
        assertEq(vm.parseJsonAddress(json, ".attestation"), address(script.attestation()));
        assertEq(vm.parseJsonAddress(json, ".tokens.GME.token"), address(script.stock("GME").token));
        assertEq(vm.parseJsonAddress(json, ".tokens.TSLA.feed"), address(script.stock("TSLA").feed));
        assertEq(vm.parseJsonAddress(json, ".tokens.NVDA.pool"), address(script.stock("NVDA").pool));
        assertEq(vm.parseJsonAddress(json, ".tokens.HIMS.token"), address(script.stock("HIMS").token));
        assertEq(vm.parseJsonAddress(json, ".counterfeits.GME.token"), address(script.counterfeitGME()));
        assertEq(vm.parseJsonAddress(json, ".counterfeits.GME.pool"), address(script.counterfeitGMEPool()));
        assertEq(vm.parseJsonAddress(json, ".honeypot.token"), address(script.honeypot()));
        assertEq(vm.parseJsonAddress(json, ".honeypot.pool"), address(script.honeypotPool()));
        assertEq(vm.parseJsonAddress(json, ".lending.CORRECT"), address(script.lendingCorrect()));
        assertEq(vm.parseJsonAddress(json, ".lending.DOUBLE_MULTIPLIER"), address(script.lendingDouble()));
        assertEq(vm.parseJsonAddress(json, ".lending.RAW_BALANCE_SPOT_FEED"), address(script.lendingRaw()));
        address[] memory agents = vm.parseJsonAddressArray(json, ".agents");
        assertEq(agents.length, 5);
        assertEq(agents[0], 0x70997970C51812dc3A010C7d01b50e0d17dc79C8); // anvil #1
        assertEq(agents[4], 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc); // anvil #5
        vm.removeFile(path);
    }

    function test_worldInvariants() public view {
        // Seed prices
        string[4] memory syms = ["GME", "TSLA", "NVDA", "HIMS"];
        int256[4] memory px = [int256(25e8), 250e8, 180e8, 40e8];
        for (uint256 i = 0; i < 4; i++) {
            DeployWorld.StockDeployment memory d = script.stock(syms[i]);
            (, int256 a,,,) = d.feed.latestRoundData();
            assertEq(a, px[i]);
            assertTrue(script.registry().isRegistered(address(d.token)));
            uint256 spot = d.pool.spotPriceUsd8();
            // within 0.5% of fair value
            assertApproxEqRel(spot, uint256(px[i]), 0.005e18);
        }
        // Counterfeit: more USDG liquidity and more volume than genuine, priced ~$31, unregistered
        SimplePool g = script.stock("GME").pool;
        SimplePool c = script.counterfeitGMEPool();
        (, uint256 gUsd) = g.getReserves();
        (, uint256 cUsd) = c.getReserves();
        assertGt(cUsd, gUsd);
        assertGt(c.cumulativeVolume1(), g.cumulativeVolume1());
        assertApproxEqRel(c.spotPriceUsd8(), 31e8, 0.01e18);
        assertFalse(script.registry().isRegistered(address(script.counterfeitGME())));
        // Agents and deployer funded
        address[] memory agents = script.agents();
        for (uint256 i = 0; i < agents.length; i++) {
            assertEq(script.usdg().balanceOf(agents[i]), 10_000e6);
        }
        assertGe(script.stock("GME").token.balanceOf(script.deployer()), 1_000e18);
        // Lending markets funded and wired to the GME feed
        assertEq(uint256(script.lendingCorrect().valuation()), uint256(LendingMarket.Valuation.CORRECT));
        assertEq(script.lendingDouble().feed(), address(script.stock("GME").feed));
        assertEq(script.usdg().balanceOf(address(script.lendingRaw())), 1_000_000e6);
    }

    function test_agentBuysGenuineGmeAndHoneypotTrapsSellers() public {
        address agent = script.agents()[0];
        SimplePool g = script.stock("GME").pool;
        StockToken gme = script.stock("GME").token;
        vm.startPrank(agent);
        script.usdg().approve(address(g), type(uint256).max);
        uint256 out = g.buy(100e6, 0, agent);
        assertApproxEqRel(out, 4e18, 0.01e18);
        assertEq(gme.balanceOf(agent), out);
        vm.stopPrank();

        // Agent holding HIMS can buy BONER but cannot sell it.
        StockToken hims = script.stock("HIMS").token;
        SimplePool hp = script.honeypotPool();
        vm.prank(script.deployer());
        hims.transfer(agent, 1e18);
        vm.startPrank(agent);
        hims.approve(address(hp), type(uint256).max);
        uint256 boner = hp.buy(1e18, 0, agent);
        script.honeypot().approve(address(hp), type(uint256).max);
        vm.expectRevert(HoneypotMeme.TradingRestricted.selector);
        hp.sell(boner, 0, agent);
        vm.stopPrank();
    }
}
