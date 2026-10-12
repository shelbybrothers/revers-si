// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Append-only on-chain record of crash-test runs. Permissionless: the attester address is part
///         of every event, so consumers decide whose attestations they trust.
contract ReversAttestation {
    struct Latest {
        bytes32 runHash;
        uint16 score;
        uint64 at;
    }

    mapping(bytes32 => Latest) internal _latest;

    event Attested(address indexed attester, bytes32 indexed runHash, string targetId, uint16 score, string uri);

    error ScoreOutOfRange(uint16 score);

    function attest(bytes32 runHash, string calldata targetId, uint16 score, string calldata uri) external {
        if (score > 100) revert ScoreOutOfRange(score);
        _latest[keccak256(bytes(targetId))] = Latest(runHash, score, uint64(block.timestamp));
        emit Attested(msg.sender, runHash, targetId, score, uri);
    }

    function latest(string calldata targetId) external view returns (bytes32 runHash, uint16 score, uint64 at) {
        Latest memory l = _latest[keccak256(bytes(targetId))];
        return (l.runHash, l.score, l.at);
    }
}
