// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ITierAttestation} from "./interfaces/ITierAttestation.sol";

/// @title TierAttestation
/// @notice Holds the coarse spend tier for each advertiser: Minimal, Moderate or
///         Major. The exact cumulative figure is read inside the Chainlink CRE
///         enclave and never reaches this contract - not as an argument, not in
///         storage, not in an event.
/// @dev That omission is the whole point, so it is enforced by shape rather than
///      by convention: no function on this contract accepts an amount, so there is
///      no path by which a raw spend figure could be written even by mistake. The
///      test suite asserts this against the compiled ABI.
///
///      Two further properties keep the signal honest:
///      - Windows are monotonic per advertiser, so a stale report cannot be
///        replayed to downgrade a tier or resurrect an expired one.
///      - Attestations expire. `currentTierOf` returns `None` once an attestation
///        is older than `attestationValidity`, because a tier nobody has refreshed
///        is not evidence of current spend.
contract TierAttestation is AccessControl, ITierAttestation {
    /// @notice Held by the CRE attestation receiver - the only writer.
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    /// @notice Ceiling on how long an attestation may be treated as current, fixed
    ///         at compile time so no admin can make a stale tier look fresh forever.
    uint64 public constant MAX_ATTESTATION_VALIDITY = 180 days;

    /// @notice How long after `windowEnd` an attestation still counts as current.
    uint64 public attestationValidity;

    mapping(address => Attestation) private _attestations;

    /// @notice Advertisers that have ever been attested, in first-attestation order.
    address[] private _attested;
    mapping(address => bool) private _seen;

    event TierAttested(
        address indexed advertiser,
        Tier indexed tier,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 attestedAt
    );

    event AttestationValidityUpdated(uint64 previous, uint64 current);

    error InvalidAdvertiser();
    error InvalidTier();
    error InvalidWindow(uint64 windowStart, uint64 windowEnd);
    error WindowInFuture(uint64 windowEnd, uint64 nowTimestamp);
    error StaleWindow(uint64 windowEnd, uint64 lastWindowEnd);
    error ValidityTooLong(uint64 requested, uint64 maximum);

    constructor(address admin, address attestor, uint64 attestationValidity_) {
        if (attestationValidity_ == 0 || attestationValidity_ > MAX_ATTESTATION_VALIDITY) {
            revert ValidityTooLong(attestationValidity_, MAX_ATTESTATION_VALIDITY);
        }

        attestationValidity = attestationValidity_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (attestor != address(0)) {
            _grantRole(ATTESTOR_ROLE, attestor);
        }
    }

    // ---------------------------------------------------------------------
    // Attestation
    // ---------------------------------------------------------------------

    /// @notice Record the tier a Confidential Workflow computed for a rolling window.
    /// @dev Deliberately takes no amount. The workflow reads the exact cumulative
    ///      spend from the escrow inside the TEE, buckets it, and reports only the
    ///      bucket.
    /// @param advertiser The advertiser the window was computed over.
    /// @param tier The bucket the enclave placed them in. `None` is not accepted;
    ///        absence of an attestation already means "no payment on record".
    /// @param windowStart Inclusive start of the rolling window.
    /// @param windowEnd Exclusive end of the window. Must move forward every time.
    function recordTier(address advertiser, Tier tier, uint64 windowStart, uint64 windowEnd)
        external
        onlyRole(ATTESTOR_ROLE)
    {
        if (advertiser == address(0)) revert InvalidAdvertiser();
        if (tier == Tier.None) revert InvalidTier();
        if (windowStart >= windowEnd) revert InvalidWindow(windowStart, windowEnd);
        if (windowEnd > block.timestamp) revert WindowInFuture(windowEnd, uint64(block.timestamp));

        Attestation storage existing = _attestations[advertiser];
        if (existing.windowEnd != 0 && windowEnd <= existing.windowEnd) {
            revert StaleWindow(windowEnd, existing.windowEnd);
        }

        existing.tier = tier;
        existing.windowStart = windowStart;
        existing.windowEnd = windowEnd;
        existing.attestedAt = uint64(block.timestamp);

        if (!_seen[advertiser]) {
            _seen[advertiser] = true;
            _attested.push(advertiser);
        }

        emit TierAttested(advertiser, tier, windowStart, windowEnd, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function tierOf(address advertiser) external view returns (Tier) {
        return _attestations[advertiser].tier;
    }

    function currentTierOf(address advertiser) public view returns (Tier) {
        return isCurrent(advertiser) ? _attestations[advertiser].tier : Tier.None;
    }

    function isCurrent(address advertiser) public view returns (bool) {
        Attestation storage a = _attestations[advertiser];
        if (a.windowEnd == 0) return false;
        return block.timestamp <= uint256(a.windowEnd) + attestationValidity;
    }

    function getAttestation(address advertiser) external view returns (Attestation memory) {
        return _attestations[advertiser];
    }

    function attestedCount() external view returns (uint256) {
        return _attested.length;
    }

    function attestedAt(uint256 index) external view returns (address) {
        return _attested[index];
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setAttestationValidity(uint64 newValidity) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newValidity == 0 || newValidity > MAX_ATTESTATION_VALIDITY) {
            revert ValidityTooLong(newValidity, MAX_ATTESTATION_VALIDITY);
        }
        emit AttestationValidityUpdated(attestationValidity, newValidity);
        attestationValidity = newValidity;
    }
}
