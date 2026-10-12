// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @notice Constant-product pool, 0.3% fee. token0 = base (stock token), token1 = quote (USDG for stock pools).
///         Token transfers are real, so a registry global pause makes swaps on stock pools revert.
contract SimplePool {
    address public owner;
    address public immutable token0;
    address public immutable token1;
    uint8 internal immutable _dec0;
    uint8 internal immutable _dec1;

    uint256 internal _reserve0;
    uint256 internal _reserve1;
    /// @notice Cumulative quote-token (token1) volume across buys and sells, in token1 units.
    uint256 public cumulativeVolume1;
    uint256 public swapCount;

    event Swap(address indexed sender, bool isBuy, uint256 amountIn, uint256 amountOut, address indexed to);
    event LiquidityAdded(uint256 amount0, uint256 amount1);

    error NotOwner();
    error Slippage(uint256 out, uint256 minOut);
    error InsufficientLiquidity();
    error ZeroAmount();

    constructor(address token0_, address token1_) {
        owner = msg.sender;
        token0 = token0_;
        token1 = token1_;
        _dec0 = IERC20Min(token0_).decimals();
        _dec1 = IERC20Min(token1_).decimals();
    }

    function getReserves() external view returns (uint256 reserve0, uint256 reserve1) {
        return (_reserve0, _reserve1);
    }

    /// @notice Price of 1 whole token0 in token1 units, 8 decimals. For stock/USDG pools this is USD.
    function spotPriceUsd8() external view returns (uint256) {
        if (_reserve0 == 0) return 0;
        return (_reserve1 * (10 ** _dec0) * 1e8) / (_reserve0 * (10 ** _dec1));
    }

    function quoteBuy(uint256 usdgIn) public view returns (uint256 tokensOut) {
        return _getOut(usdgIn, _reserve1, _reserve0);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 usdgOut) {
        return _getOut(tokensIn, _reserve0, _reserve1);
    }

    function buy(uint256 usdgIn, uint256 minOut, address to) external returns (uint256 tokensOut) {
        if (usdgIn == 0) revert ZeroAmount();
        tokensOut = quoteBuy(usdgIn);
        if (tokensOut < minOut) revert Slippage(tokensOut, minOut);
        IERC20Min(token1).transferFrom(msg.sender, address(this), usdgIn);
        IERC20Min(token0).transfer(to, tokensOut);
        _reserve1 += usdgIn;
        _reserve0 -= tokensOut;
        cumulativeVolume1 += usdgIn;
        swapCount++;
        emit Swap(msg.sender, true, usdgIn, tokensOut, to);
    }

    function sell(uint256 tokensIn, uint256 minOut, address to) external returns (uint256 usdgOut) {
        if (tokensIn == 0) revert ZeroAmount();
        usdgOut = quoteSell(tokensIn);
        if (usdgOut < minOut) revert Slippage(usdgOut, minOut);
        IERC20Min(token0).transferFrom(msg.sender, address(this), tokensIn);
        IERC20Min(token1).transfer(to, usdgOut);
        _reserve0 += tokensIn;
        _reserve1 -= usdgOut;
        cumulativeVolume1 += usdgOut;
        swapCount++;
        emit Swap(msg.sender, false, tokensIn, usdgOut, to);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external {
        if (msg.sender != owner) revert NotOwner();
        IERC20Min(token0).transferFrom(msg.sender, address(this), amount0);
        IERC20Min(token1).transferFrom(msg.sender, address(this), amount1);
        _reserve0 += amount0;
        _reserve1 += amount1;
        emit LiquidityAdded(amount0, amount1);
    }

    function _getOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * reserveOut) / (reserveIn * 1000 + inWithFee);
    }
}
