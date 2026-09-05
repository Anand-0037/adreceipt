// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ENSIP-1 address profile. Interface id 0x3b3b57de.
interface IAddrResolver {
    event AddrChanged(bytes32 indexed node, address a);

    function addr(bytes32 node) external view returns (address payable);
}

/// @notice ENSIP-5 text-record profile. Interface id 0x59d1d43c.
/// @dev The event signature is the ENS-standard one so existing resolver tooling
///      and subgraph templates index Disclosed names without special-casing.
interface ITextResolver {
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);

    function text(bytes32 node, string calldata key) external view returns (string memory);
}
