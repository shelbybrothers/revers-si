// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "./ERC20.sol";

/// @notice Hyped memecoin quoted against a stock token. Buys (pool -> buyer) work; sells (anyone but the
///         owner -> pool) revert. Classic honeypot, replicated for the honeypot-pair scenario.
contract HoneypotMeme is ERC20 {
    address public owner;
    address public pool;

    error NotOwner();
    error TradingRestricted();

    constructor() ERC20("HIMSBONER", "BONER", 18) {
        owner = msg.sender;
    }

    function setPool(address pool_) external {
        if (msg.sender != owner) revert NotOwner();
        pool = pool_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _mint(to, amount);
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (to == pool && pool != address(0) && from != owner) revert TradingRestricted();
    }
}
