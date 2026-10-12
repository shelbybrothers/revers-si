// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "./ERC20.sol";
import {StockRegistry} from "./StockRegistry.sol";

/// @notice Genuine issuer-minted stock token with an ERC-8056-style UI multiplier.
///         Balances are raw token units; uiMultiplier() (1e18 = 1.0) converts raw units to share-equivalents.
///         A scheduled multiplier takes effect once block.timestamp >= effectiveAt.
contract StockToken is ERC20 {
    uint256 internal constant ONE = 1e18;

    address public immutable issuer;
    StockRegistry internal immutable _registry;

    uint256 internal _currentMultiplier;
    uint256 public newUIMultiplier;
    uint256 public effectiveAt;

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt);

    error NotIssuer();
    error GloballyPaused();
    error Blocklisted(address account);
    error InvalidMultiplier();
    error EffectiveInPast();

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(string memory name_, string memory symbol_, address registry_) ERC20(name_, symbol_, 18) {
        issuer = msg.sender;
        _registry = StockRegistry(registry_);
        _currentMultiplier = ONE;
        newUIMultiplier = ONE;
        effectiveAt = 0;
    }

    function registry() external view returns (address) {
        return address(_registry);
    }

    /// @notice Active multiplier: the scheduled one once effective, else the current one.
    function uiMultiplier() public view returns (uint256) {
        return block.timestamp >= effectiveAt ? newUIMultiplier : _currentMultiplier;
    }

    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt_) external onlyIssuer {
        if (newMultiplier == 0) revert InvalidMultiplier();
        if (effectiveAt_ < block.timestamp) revert EffectiveInPast();
        uint256 oldMultiplier = uiMultiplier();
        _currentMultiplier = oldMultiplier;
        newUIMultiplier = newMultiplier;
        effectiveAt = effectiveAt_;
        emit UIMultiplierUpdated(oldMultiplier, newMultiplier, effectiveAt_);
    }

    function mint(address to, uint256 amount) external onlyIssuer {
        if (_registry.blocklisted(to)) revert Blocklisted(to);
        _mint(to, amount);
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (_registry.globalPaused()) revert GloballyPaused();
        if (_registry.blocklisted(from)) revert Blocklisted(from);
        if (_registry.blocklisted(to)) revert Blocklisted(to);
    }
}
