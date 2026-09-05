// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAdvertiserRegistry
/// @notice Read surface of the advertiser registry, consumed by the escrow,
///         the tier attestation contract and the ENS subname issuer.
interface IAdvertiserRegistry {
    /// @dev None     - never registered.
    ///      Pending  - claim made, DNS challenge issued, not yet attested.
    ///      Verified - domain control attested on-chain by the CRE receiver.
    ///      Revoked  - previously verified, attestation withdrawn.
    enum Status {
        None,
        Pending,
        Verified,
        Revoked
    }

    struct Advertiser {
        string name;
        string domain;
        bytes32 challenge;
        uint64 registeredAt;
        uint64 verifiedAt;
        Status status;
    }

    function isVerified(address advertiser) external view returns (bool);

    function getAdvertiser(address advertiser) external view returns (Advertiser memory);

    function registeredAt(address advertiser) external view returns (uint64);
}
