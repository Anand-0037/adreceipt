// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Canonical
/// @notice The one way Disclosed turns a human string - a brand name, a domain, a
///         topic category - into a key. Shared by every contract so the registry,
///         the escrow and the off-chain indexer never disagree about identity.
library Canonical {
    /// @dev ASCII-lowercases, then keccak256.
    ///
    ///      This folds case and nothing else. Two strings that a human reads as the
    ///      same brand but that differ by a single byte - "deployco.com" against the
    ///      same word carrying a Cyrillic U+0435 - hash to different keys, so a
    ///      uniqueness check built on this function will not see them as a
    ///      collision. That is the correct behaviour for a hash, and it is why
    ///      callers that treat the hash as an identity must gate what they let in:
    ///      see `AdvertiserRegistry._requireValidName` and `_requireValidDomain`,
    ///      which restrict claimed names and domains to ASCII before a claim is ever
    ///      recorded.
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
