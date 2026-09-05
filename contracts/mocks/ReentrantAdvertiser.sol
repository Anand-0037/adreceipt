// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AdvertiserRegistry} from "../AdvertiserRegistry.sol";
import {PlacementEscrow} from "../PlacementEscrow.sol";

/// @notice Test-only advertiser that tries to drain the escrow by re-entering
///         `withdrawPlacement` from its receive hook. Never deployed in production.
contract ReentrantAdvertiser {
    AdvertiserRegistry public immutable registry;
    PlacementEscrow public immutable escrow;

    uint256 public targetPlacementId;
    bool public reentered;
    bool public reentryReverted;

    constructor(AdvertiserRegistry registry_, PlacementEscrow escrow_) {
        registry = registry_;
        escrow = escrow_;
    }

    function register(string calldata name, string calldata domain) external {
        registry.register(name, domain);
    }

    function fund(string calldata category) external payable returns (uint256 id) {
        id = escrow.createPlacement{value: msg.value}(category);
        targetPlacementId = id;
    }

    function attack() external {
        escrow.withdrawPlacement(targetPlacementId);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        try escrow.withdrawPlacement(targetPlacementId) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}
