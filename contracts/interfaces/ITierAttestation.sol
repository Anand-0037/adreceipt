// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ITierAttestation
/// @notice The coarse spend signal Disclosed publishes, and the only spend
///         information that ever leaves the enclave.
interface ITierAttestation {
    /// @dev `None` is a real answer, not a failure: it means no current
    ///      attestation exists, which the badge renders as "no payment on record".
    enum Tier {
        None,
        Minimal,
        Moderate,
        Major
    }

    struct Attestation {
        Tier tier;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 attestedAt;
    }

    /// @notice The tier as last attested, ignoring staleness.
    function tierOf(address advertiser) external view returns (Tier);

    /// @notice The tier only if the attestation is still within its validity
    ///         window, otherwise `Tier.None`. This is what the badge should read:
    ///         a tier nobody has refreshed is not evidence of current spend.
    function currentTierOf(address advertiser) external view returns (Tier);

    function getAttestation(address advertiser) external view returns (Attestation memory);
}
