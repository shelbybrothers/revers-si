// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Replica of the issuer registry: canonical token list, global pause, address blocklist.
contract StockRegistry {
    address public owner;
    bool public globalPaused;

    address[] private _tokens;
    mapping(address => bool) public isRegistered;
    mapping(address => bool) public blocklisted;

    event TokenRegistered(address indexed token);
    event GlobalPauseSet(bool paused);
    event BlocklistSet(address indexed account, bool blocked);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error AlreadyRegistered(address token);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function register(address token) external onlyOwner {
        if (isRegistered[token]) revert AlreadyRegistered(token);
        isRegistered[token] = true;
        _tokens.push(token);
        emit TokenRegistered(token);
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function pauseAll() external onlyOwner {
        globalPaused = true;
        emit GlobalPauseSet(true);
    }

    function unpauseAll() external onlyOwner {
        globalPaused = false;
        emit GlobalPauseSet(false);
    }

    function setBlocklisted(address account, bool blocked) external onlyOwner {
        blocklisted[account] = blocked;
        emit BlocklistSet(account, blocked);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
