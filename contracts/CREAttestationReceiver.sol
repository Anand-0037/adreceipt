// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {IAdvertiserRegistry} from "./interfaces/IAdvertiserRegistry.sol";
import {ITierAttestation} from "./interfaces/ITierAttestation.sol";
import {TierAttestation} from "./TierAttestation.sol";

/// @title CREAttestationReceiver
/// @notice The single on-chain landing point for both Chainlink CRE Confidential
///         Workflows: the DNS domain check and the cumulative-spend tier
///         computation. It holds the writer role on the registry and on the tier
///         contract, so those two contracts each have exactly one caller.
/// @dev Concentrating the privilege here is the point. The trust boundary is one
///      address - the CRE Forwarder holding `FORWARDER_ROLE` - and revoking it
///      severs the oracle's write access to the entire system in one transaction.
///
///      Neither workflow reports a secret. The DNS workflow fetches and compares
///      the challenge inside the enclave and returns a boolean; the tier workflow
///      reads the exact cumulative spend inside the enclave and returns a bucket.
///      What lands here is already the redacted result.
contract CREAttestationReceiver is AccessControl, IReceiver {
    /// @notice Held by the CRE Forwarder that delivers workflow reports.
    bytes32 public constant FORWARDER_ROLE = keccak256("FORWARDER_ROLE");

    /// @notice Held by an operator key used to replay CRE CLI simulation output
    ///         while no Forwarder is deployed. Same validation, different door.
    bytes32 public constant SIMULATOR_ROLE = keccak256("SIMULATOR_ROLE");

    uint8 public constant REPORT_DOMAIN_VERIFICATION = 1;
    uint8 public constant REPORT_TIER_ATTESTATION = 2;

    IAdvertiserRegistry public immutable registry;
    TierAttestation public immutable tiers;

    /// @notice Reports already applied, keyed by the hash of their metadata, so a
    ///         forwarder retry cannot double-apply a verdict.
    mapping(bytes32 => bool) public consumedReports;

    event DomainVerificationRecorded(
        address indexed advertiser, bool verified, bytes32 indexed challenge, uint64 checkedAt
    );

    event TierAttestationForwarded(
        address indexed advertiser, ITierAttestation.Tier indexed tier, uint64 windowStart, uint64 windowEnd
    );

    event ReportProcessed(uint8 indexed kind, bytes32 indexed metadataHash);

    error UnknownReportKind(uint8 kind);
    error ReportAlreadyConsumed(bytes32 metadataHash);
    error AdvertiserNotRegistered(address advertiser);
    error ChallengeMismatch(bytes32 expected, bytes32 provided);
    error CheckTimestampInFuture(uint64 checkedAt, uint64 nowTimestamp);

    constructor(address admin, IAdvertiserRegistry registry_, TierAttestation tiers_) {
        registry = registry_;
        tiers = tiers_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Chainlink CRE entry point
    // ---------------------------------------------------------------------

    /// @notice Apply a report delivered by the CRE Forwarder.
    /// @param metadata Workflow provenance assembled by the forwarder. Hashed for
    ///        replay protection and event correlation; its internal layout is the
    ///        forwarder's concern, not this contract's.
    /// @param report `abi.encode(uint8 kind, bytes payload)`.
    function onReport(bytes calldata metadata, bytes calldata report) external onlyRole(FORWARDER_ROLE) {
        bytes32 metadataHash = keccak256(metadata);
        if (consumedReports[metadataHash]) revert ReportAlreadyConsumed(metadataHash);
        consumedReports[metadataHash] = true;

        (uint8 kind, bytes memory payload) = abi.decode(report, (uint8, bytes));

        if (kind == REPORT_DOMAIN_VERIFICATION) {
            (address advertiser, bool verified, bytes32 challenge, uint64 checkedAt) =
                abi.decode(payload, (address, bool, bytes32, uint64));
            _recordDomainVerification(advertiser, verified, challenge, checkedAt);
        } else if (kind == REPORT_TIER_ATTESTATION) {
            (address advertiser, uint8 tier, uint64 windowStart, uint64 windowEnd) =
                abi.decode(payload, (address, uint8, uint64, uint64));
            _recordTier(advertiser, ITierAttestation.Tier(tier), windowStart, windowEnd);
        } else {
            revert UnknownReportKind(kind);
        }

        emit ReportProcessed(kind, metadataHash);
    }

    // ---------------------------------------------------------------------
    // Simulation entry points
    // ---------------------------------------------------------------------

    /// @notice Apply a domain verdict produced by a CRE CLI simulation run.
    /// @dev Held behind a distinct role so the audit trail distinguishes a
    ///      simulated attestation from a forwarded one, and so revoking the
    ///      simulator does not disturb the live forwarder.
    function submitDomainVerification(address advertiser, bool verified, bytes32 challenge, uint64 checkedAt)
        external
        onlyRole(SIMULATOR_ROLE)
    {
        _recordDomainVerification(advertiser, verified, challenge, checkedAt);
    }

    function submitTierAttestation(
        address advertiser,
        ITierAttestation.Tier tier,
        uint64 windowStart,
        uint64 windowEnd
    ) external onlyRole(SIMULATOR_ROLE) {
        _recordTier(advertiser, tier, windowStart, windowEnd);
    }

    // ---------------------------------------------------------------------
    // Report encoding helpers - shared with the workflow and the test suite
    // ---------------------------------------------------------------------

    function encodeDomainReport(address advertiser, bool verified, bytes32 challenge, uint64 checkedAt)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(
            REPORT_DOMAIN_VERIFICATION, abi.encode(advertiser, verified, challenge, checkedAt)
        );
    }

    function encodeTierReport(
        address advertiser,
        ITierAttestation.Tier tier,
        uint64 windowStart,
        uint64 windowEnd
    ) external pure returns (bytes memory) {
        return abi.encode(
            REPORT_TIER_ATTESTATION, abi.encode(advertiser, uint8(tier), windowStart, windowEnd)
        );
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev The challenge check is what makes a replayed verdict useless. Every
    ///      claim change reissues the challenge, so an attestation for the domain
    ///      an advertiser used to claim can never be applied to the one they claim
    ///      now.
    function _recordDomainVerification(
        address advertiser,
        bool verified,
        bytes32 challenge,
        uint64 checkedAt
    ) private {
        bytes32 expected = registry.challengeOf(advertiser);
        if (expected == bytes32(0)) revert AdvertiserNotRegistered(advertiser);
        if (challenge != expected) revert ChallengeMismatch(expected, challenge);
        if (checkedAt > block.timestamp) revert CheckTimestampInFuture(checkedAt, uint64(block.timestamp));

        registry.setVerified(advertiser, verified);

        emit DomainVerificationRecorded(advertiser, verified, challenge, checkedAt);
    }

    function _recordTier(
        address advertiser,
        ITierAttestation.Tier tier,
        uint64 windowStart,
        uint64 windowEnd
    ) private {
        tiers.recordTier(advertiser, tier, windowStart, windowEnd);
        emit TierAttestationForwarded(advertiser, tier, windowStart, windowEnd);
    }

    // ---------------------------------------------------------------------
    // ERC-165
    // ---------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == type(IReceiver).interfaceId || super.supportsInterface(interfaceId);
    }
}
