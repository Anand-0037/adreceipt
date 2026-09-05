// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IPlacementEscrow
/// @notice Read surface of the placement escrow. The Chainlink Confidential
///         Workflow calls into this from inside the enclave to obtain the exact
///         cumulative spend it needs to compute a coarse tier - the figure that is
///         deliberately never published on-chain in raw form.
interface IPlacementEscrow {
    struct Placement {
        address advertiser;
        uint96 amount;
        bytes32 categoryHash;
        uint64 createdAt;
        uint64 unlockAt;
        bool withdrawn;
    }

    /// @notice Lifetime sum of everything an advertiser has ever escrowed. Never
    ///         decreases, so withdrawing does not erase spend history.
    function lifetimeDeposited(address advertiser) external view returns (uint256);

    /// @notice Sum of deposits made at or after `since`. This is the rolling-window
    ///         input to tier computation (see the anti-gaming note in the design doc):
    ///         splitting one large placement into ten small ones lands on the same tier.
    function depositedSince(address advertiser, uint64 since) external view returns (uint256);

    /// @notice Number of placements the advertiser has ever created, withdrawn or not.
    ///         Rendered on the badge as "47 placements".
    function placementCount(address advertiser) external view returns (uint256);
}
