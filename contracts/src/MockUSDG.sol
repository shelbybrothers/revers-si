// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "./ERC20.sol";

/// @notice Test-only stand-in for USDG ("Global Dollar"), 6 decimals. Anyone can mint: replica world only.
contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG", 6) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
