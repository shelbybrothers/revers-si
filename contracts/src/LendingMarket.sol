// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20L {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IStockTokenL {
    function uiMultiplier() external view returns (uint256);
}

interface IEquityFeedL {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function oraclePaused() external view returns (bool);
}

/// @notice Single-collateral lending market (collateral = stock token, debt = USDG) with three
///         valuation implementations, two of them deliberately buggy, to drill integrations.
///         CORRECT:               value = balance * answer            (feed already includes multiplier)
///                                + reverts StalePrice() on stale or paused feed.
///         DOUBLE_MULTIPLIER:     value = balance * answer * uiMultiplier   (bug: multiplier applied twice)
///         RAW_BALANCE_SPOT_FEED: value = balance * answer / uiMultiplier   (bug: drops multiplier)
///         Buggy variants never check staleness or pause.
contract LendingMarket {
    enum Valuation {
        CORRECT,
        DOUBLE_MULTIPLIER,
        RAW_BALANCE_SPOT_FEED
    }

    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 8000; // 80%
    uint256 internal constant ONE = 1e18;

    address public owner;
    address public immutable collateralToken;
    address public immutable debtToken;
    address public immutable feed;
    Valuation public immutable valuation;
    uint256 public immutable maxStaleness;

    mapping(address => uint256) public collateralOf; // raw stock token units (18 decimals)
    mapping(address => uint256) public debtOf; // USDG (6 decimals)

    event Deposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);

    error StalePrice();
    error InvalidPrice();
    error Unhealthy(uint256 healthFactor);
    error ZeroAmount();

    constructor(address collateralToken_, address debtToken_, address feed_, Valuation valuation_, uint256 maxStaleness_) {
        owner = msg.sender;
        collateralToken = collateralToken_;
        debtToken = debtToken_;
        feed = feed_;
        valuation = valuation_;
        maxStaleness = maxStaleness_;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC20L(collateralToken).transferFrom(msg.sender, address(this), amount);
        collateralOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        debtOf[msg.sender] += amount;
        uint256 hf = healthFactor(msg.sender);
        if (hf < ONE) revert Unhealthy(hf);
        IERC20L(debtToken).transfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 d = debtOf[msg.sender];
        if (amount > d) amount = d;
        IERC20L(debtToken).transferFrom(msg.sender, address(this), amount);
        debtOf[msg.sender] = d - amount;
        emit Repaid(msg.sender, amount);
    }

    /// @notice Collateral value in USD, 8 decimals, per this market's valuation mode.
    function collateralValueUsd8(address user) public view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = IEquityFeedL(feed).latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        uint256 bal = collateralOf[user];
        uint256 px = uint256(answer);
        if (valuation == Valuation.CORRECT) {
            if (IEquityFeedL(feed).oraclePaused()) revert StalePrice();
            if (block.timestamp > updatedAt + maxStaleness) revert StalePrice();
            return (bal * px) / ONE;
        }
        uint256 m = IStockTokenL(collateralToken).uiMultiplier();
        if (valuation == Valuation.DOUBLE_MULTIPLIER) {
            return (((bal * px) / ONE) * m) / ONE;
        }
        // RAW_BALANCE_SPOT_FEED
        return (bal * ((px * ONE) / m)) / ONE;
    }

    /// @notice 1e18 = 1.0. type(uint256).max when there is no debt.
    function healthFactor(address user) public view returns (uint256) {
        uint256 debt = debtOf[user];
        uint256 value8 = collateralValueUsd8(user);
        if (debt == 0) return type(uint256).max;
        uint256 debtUsd8 = debt * 100; // USDG 6 decimals -> 8 decimals
        return (value8 * LIQUIDATION_THRESHOLD_BPS * ONE) / (10_000 * debtUsd8);
    }

    function isLiquidatable(address user) external view returns (bool) {
        return healthFactor(user) < ONE;
    }
}
