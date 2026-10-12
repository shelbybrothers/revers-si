// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "./ERC20.sol";

/// @notice Impostor token: copies a genuine token's name and symbol and even exposes uiMultiplier()
///         (like real-world fake stock tokens), but is permissionless, unregistered, and has no
///         pause / blocklist. Every line of this contract is "clean" - that is the point.
contract CounterfeitStockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_, 18) {}

    /// @notice Permissionless mint: anyone can create supply.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }
}
