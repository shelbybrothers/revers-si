// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IUIMultiplier {
    function uiMultiplier() external view returns (uint256);
}

/// @notice Chainlink AggregatorV3-compatible tokenized-equity feed replica.
///         The answer ALREADY includes the token's uiMultiplier at update time:
///         answer = equityPrice * uiMultiplier / 1e18 (price per raw token unit, 8 decimals).
contract EquityFeed {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint8 public constant decimals = 8;
    uint256 public constant version = 4;

    address public owner;
    address public immutable token;
    string public description;

    bool public oraclePaused;
    int256 public equityPrice;
    uint80 public latestRound;
    mapping(uint80 => Round) internal _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event EquityPriceSet(int256 equityPrice, uint256 multiplier, int256 answer);
    event OraclePauseSet(bool paused);

    error NotOwner();
    error OracleIsPaused();
    error InvalidPrice();
    error InvalidTimestamp();
    error NoData();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address token_, string memory description_) {
        owner = msg.sender;
        token = token_;
        description = description_;
    }

    function setEquityPrice(int256 price8) external onlyOwner {
        _set(price8, block.timestamp);
    }

    /// @notice Scenario helper: publish a round with an explicit (past) updatedAt.
    function setEquityPriceAt(int256 price8, uint256 updatedAt_) external onlyOwner {
        if (updatedAt_ > block.timestamp) revert InvalidTimestamp();
        _set(price8, updatedAt_);
    }

    function _set(int256 price8, uint256 ts) internal {
        if (oraclePaused) revert OracleIsPaused();
        if (price8 <= 0) revert InvalidPrice();
        uint256 m = IUIMultiplier(token).uiMultiplier();
        int256 answer = (price8 * int256(m)) / 1e18;
        equityPrice = price8;
        uint80 id = latestRound + 1;
        latestRound = id;
        _rounds[id] = Round(answer, ts, ts);
        emit EquityPriceSet(price8, m, answer);
        emit AnswerUpdated(answer, id, ts);
    }

    function pauseOracle() external onlyOwner {
        oraclePaused = true;
        emit OraclePauseSet(true);
    }

    function unpauseOracle() external onlyOwner {
        oraclePaused = false;
        emit OraclePauseSet(false);
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 roundId_)
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = _rounds[roundId_];
        if (r.updatedAt == 0) revert NoData();
        return (roundId_, r.answer, r.startedAt, r.updatedAt, roundId_);
    }

    function latestAnswer() external view returns (int256) {
        return _rounds[latestRound].answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _rounds[latestRound].updatedAt;
    }
}
