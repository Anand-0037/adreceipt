// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Canonical
/// @notice The one way Disclosed turns a human string - a brand name, a domain, a
///         topic category - into a key. Shared by every contract so the registry,
///         the escrow and the off-chain indexer never disagree about identity.
library Canonical {
    /// @dev ASCII-lowercases, then keccak256. Non-ASCII bytes pass through
    ///      untouched, so the hash stays injective over UTF-8 input.
    function hash(string memory value) internal pure returns (bytes32) {
        bytes memory b = bytes(value);
        for (uint256 i = 0; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            if (c >= 0x41 && c <= 0x5A) {
                b[i] = bytes1(c + 32);
            }
        }
        return keccak256(b);
    }
}
