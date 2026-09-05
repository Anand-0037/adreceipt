// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver
/// @notice The shape a Chainlink CRE Forwarder expects of a contract it delivers
///         workflow reports to. Declared locally rather than pulled from the
///         Chainlink contracts package so the build stays dependency-light; the
///         signature and the ERC-165 handshake match the Keystone forwarder.
/// @dev `metadata` carries the workflow provenance the forwarder assembled;
///      `report` is the payload the workflow returned from inside the TEE.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
