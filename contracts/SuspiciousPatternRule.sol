// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAdvertiserRegistry} from "./interfaces/IAdvertiserRegistry.sol";
import {IPlacementEscrow} from "./interfaces/IPlacementEscrow.sol";
import {ITierAttestation} from "./interfaces/ITierAttestation.sol";

/// @title SuspiciousPatternRule
/// @notice One rule, stated once, readable by anyone: an advertiser is flagged
///         when its registration is younger than `maxAccountAge`, it has made more
///         than `minPlacements` placements, and its current tier is Major.
/// @dev Deliberately not a scoring engine. A number produced by an opaque model
///      cannot be argued with; this can be checked by hand from three public
///      values. The contract holds no state about advertisers at all - it reads
///      the registry, the escrow and the tier attestation and applies the
///      conjunction - so there is nothing here to tamper with or to go stale.
///
///      The flag is an input to the auditor view. It is not shown in the chat UI
///      and it is not an accusation: it says three public facts coincide.
contract SuspiciousPatternRule is AccessControl {
    /// @notice May retune the thresholds. Cannot flag or unflag anyone directly.
    bytes32 public constant CURATOR_ROLE = keccak256("CURATOR_ROLE");

    IAdvertiserRegistry public immutable registry;
    IPlacementEscrow public immutable escrow;
    ITierAttestation public immutable tiers;

    /// @notice A registration younger than this counts as new. Default 7 days.
    uint64 public maxAccountAge;

    /// @notice Placement count must strictly exceed this. Default 10.
    uint256 public minPlacements;

    struct Evaluation {
        bool flagged;
        bool registered;
        uint64 accountAge;
        uint256 placements;
        ITierAttestation.Tier tier;
    }

    event ThresholdsUpdated(uint64 maxAccountAge, uint256 minPlacements);

    error InvalidThreshold();

    constructor(
        address admin,
        IAdvertiserRegistry registry_,
        IPlacementEscrow escrow_,
        ITierAttestation tiers_,
        uint64 maxAccountAge_,
        uint256 minPlacements_
    ) {
        if (maxAccountAge_ == 0) revert InvalidThreshold();

        registry = registry_;
        escrow = escrow_;
        tiers = tiers_;
        maxAccountAge = maxAccountAge_;
        minPlacements = minPlacements_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CURATOR_ROLE, admin);
    }

    /// @notice The three facts behind the flag, alongside the flag itself, so the
    ///         auditor view can show its working rather than just a verdict.
    function evaluate(address advertiser) public view returns (Evaluation memory result) {
        uint64 registered = registry.registeredAt(advertiser);
        if (registered == 0) {
            // Never registered here. This contract has nothing to say about them.
            return result;
        }

        result.registered = true;
        result.accountAge = uint64(block.timestamp) - registered;
        result.placements = escrow.placementCount(advertiser);
        result.tier = tiers.currentTierOf(advertiser);

        result.flagged = result.accountAge < maxAccountAge && result.placements > minPlacements
            && result.tier == ITierAttestation.Tier.Major;
    }

    function isFlagged(address advertiser) external view returns (bool) {
        return evaluate(advertiser).flagged;
    }

    /// @notice Evaluate a batch in one `eth_call`, for the auditor dashboard.
    function evaluateMany(address[] calldata advertisers) external view returns (Evaluation[] memory out) {
        out = new Evaluation[](advertisers.length);
        for (uint256 i = 0; i < advertisers.length; ++i) {
            out[i] = evaluate(advertisers[i]);
        }
    }

    function setThresholds(uint64 newMaxAccountAge, uint256 newMinPlacements) external onlyRole(CURATOR_ROLE) {
        if (newMaxAccountAge == 0) revert InvalidThreshold();
        maxAccountAge = newMaxAccountAge;
        minPlacements = newMinPlacements;
        emit ThresholdsUpdated(newMaxAccountAge, newMinPlacements);
    }
}
