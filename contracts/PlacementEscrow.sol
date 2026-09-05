// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAdvertiserRegistry} from "./interfaces/IAdvertiserRegistry.sol";
import {IPlacementEscrow} from "./interfaces/IPlacementEscrow.sol";
import {Canonical} from "./libraries/Canonical.sol";

/// @title PlacementEscrow
/// @notice Payment layer of Disclosed. A verified advertiser funds a placement
///         against a topic category; the contract holds the deposit and the
///         advertiser can reclaim it after a lock period.
/// @dev Non-custodial in the strict sense: there is no function - not for the
///      admin, not for anyone - that moves escrowed value to any address other
///      than the advertiser that deposited it. The operator cannot take custody,
///      cannot sweep, and cannot be compelled to release funds.
///
///      Two accounting numbers matter downstream. `lifetimeDeposited` never
///      decreases, so a withdrawal cannot erase spend history. `depositedSince`
///      answers the rolling-window question the confidential tier workflow asks.
///      Both are exact figures; only the coarse tier derived from them inside the
///      TEE is ever written back on-chain.
contract PlacementEscrow is AccessControl, ReentrancyGuard, Pausable, IPlacementEscrow {
    /// @notice May adjust the lock duration and pause new placements. Cannot touch funds.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Upper bound on the lock the operator can impose, fixed at deploy time
    ///         so an advertiser knows their funds can never be trapped longer than this.
    uint64 public constant MAX_LOCK_DURATION = 30 days;

    IAdvertiserRegistry public immutable registry;

    /// @notice How long a fresh deposit stays locked. Stops an advertiser from
    ///         flash-funding a Major tier and pulling the money back in the same block.
    uint64 public lockDuration;

    /// @notice Smallest accepted deposit. Guards against dust placements inflating
    ///         the placement count that appears on the badge.
    uint256 public minPlacement;

    Placement[] private _placements;

    mapping(address => uint256[]) private _byAdvertiser;
    mapping(bytes32 => uint256[]) private _byCategory;

    mapping(address => uint256) private _lifetimeDeposited;
    mapping(address => uint256) private _escrowedBalance;
    mapping(bytes32 => uint256) private _categoryLifetime;

    event PlacementCreated(
        uint256 indexed id,
        address indexed advertiser,
        bytes32 indexed categoryHash,
        string category,
        uint256 amount,
        uint64 createdAt,
        uint64 unlockAt
    );

    event PlacementWithdrawn(uint256 indexed id, address indexed advertiser, uint256 amount, uint64 timestamp);

    event LockDurationUpdated(uint64 previous, uint64 current);
    event MinPlacementUpdated(uint256 previous, uint256 current);

    error AdvertiserNotVerified(address advertiser);
    error EmptyCategory();
    error DepositTooSmall(uint256 sent, uint256 minimum);
    error DepositTooLarge(uint256 sent);
    error UnknownPlacement(uint256 id);
    error NotPlacementOwner(address caller, address owner);
    error AlreadyWithdrawn(uint256 id);
    error StillLocked(uint64 unlockAt);
    error LockTooLong(uint64 requested, uint64 maximum);
    error TransferFailed();
    error DirectPaymentRejected();

    constructor(address admin, IAdvertiserRegistry registry_, uint64 lockDuration_, uint256 minPlacement_) {
        if (lockDuration_ > MAX_LOCK_DURATION) revert LockTooLong(lockDuration_, MAX_LOCK_DURATION);

        registry = registry_;
        lockDuration = lockDuration_;
        minPlacement = minPlacement_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Advertiser actions
    // ---------------------------------------------------------------------

    /// @notice Fund a placement against a topic category.
    /// @dev Only a verified advertiser may pay. This is the ordering the whole
    ///      system rests on: prove who you are first, then pay - never the reverse.
    /// @param category Free-text topic, e.g. "backend hosting". Lowercased and
    ///        hashed into `categoryHash` so queries agree across the stack.
    /// @return id The placement identifier, also the subgraph entity id.
    function createPlacement(string calldata category)
        external
        payable
        whenNotPaused
        returns (uint256 id)
    {
        if (!registry.isVerified(msg.sender)) revert AdvertiserNotVerified(msg.sender);
        if (bytes(category).length == 0) revert EmptyCategory();
        if (msg.value < minPlacement) revert DepositTooSmall(msg.value, minPlacement);
        if (msg.value > type(uint96).max) revert DepositTooLarge(msg.value);

        bytes32 categoryHash = Canonical.hash(category);
        uint64 createdAt = uint64(block.timestamp);
        uint64 unlockAt = createdAt + lockDuration;

        id = _placements.length;
        _placements.push(
            Placement({
                advertiser: msg.sender,
                amount: uint96(msg.value),
                categoryHash: categoryHash,
                createdAt: createdAt,
                unlockAt: unlockAt,
                withdrawn: false
            })
        );

        _byAdvertiser[msg.sender].push(id);
        _byCategory[categoryHash].push(id);

        _lifetimeDeposited[msg.sender] += msg.value;
        _escrowedBalance[msg.sender] += msg.value;
        _categoryLifetime[categoryHash] += msg.value;

        emit PlacementCreated(id, msg.sender, categoryHash, category, msg.value, createdAt, unlockAt);
    }

    /// @notice Reclaim an unspent placement once its lock has elapsed.
    /// @dev Withdrawal is never pausable - the admin must not be able to strand
    ///      an advertiser's money. `lifetimeDeposited` is intentionally untouched.
    function withdrawPlacement(uint256 id) external nonReentrant {
        if (id >= _placements.length) revert UnknownPlacement(id);

        Placement storage p = _placements[id];
        if (p.advertiser != msg.sender) revert NotPlacementOwner(msg.sender, p.advertiser);
        if (p.withdrawn) revert AlreadyWithdrawn(id);
        if (block.timestamp < p.unlockAt) revert StillLocked(p.unlockAt);

        uint256 amount = p.amount;
        p.withdrawn = true;
        _escrowedBalance[msg.sender] -= amount;

        emit PlacementWithdrawn(id, msg.sender, amount, uint64(block.timestamp));

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------------
    // Views - the exact figures the confidential workflow consumes
    // ---------------------------------------------------------------------

    function lifetimeDeposited(address advertiser) external view returns (uint256) {
        return _lifetimeDeposited[advertiser];
    }

    /// @notice Sum of deposits created at or after `since`.
    /// @dev Linear in the advertiser's placement count. Intended for `eth_call`
    ///      from the CRE workflow, not for use inside a transaction.
    function depositedSince(address advertiser, uint64 since) external view returns (uint256 total) {
        uint256[] storage ids = _byAdvertiser[advertiser];
        for (uint256 i = ids.length; i > 0;) {
            unchecked {
                --i;
            }
            Placement storage p = _placements[ids[i]];
            // Ids are appended in time order, so once we fall out of the window
            // every remaining placement is older still.
            if (p.createdAt < since) break;
            total += p.amount;
        }
    }

    function placementCount(address advertiser) external view returns (uint256) {
        return _byAdvertiser[advertiser].length;
    }

    function escrowedBalance(address advertiser) external view returns (uint256) {
        return _escrowedBalance[advertiser];
    }

    function totalPlacements() external view returns (uint256) {
        return _placements.length;
    }

    function getPlacement(uint256 id) external view returns (Placement memory) {
        if (id >= _placements.length) revert UnknownPlacement(id);
        return _placements[id];
    }

    function placementsOf(address advertiser) external view returns (uint256[] memory) {
        return _byAdvertiser[advertiser];
    }

    function placementsInCategory(string calldata category) external view returns (uint256[] memory) {
        return _byCategory[Canonical.hash(category)];
    }

    function categoryLifetime(string calldata category) external view returns (uint256) {
        return _categoryLifetime[Canonical.hash(category)];
    }

    function categoryHashOf(string calldata category) external pure returns (bytes32) {
        return Canonical.hash(category);
    }

    // ---------------------------------------------------------------------
    // Operator knobs - parameters only, never funds
    // ---------------------------------------------------------------------

    function setLockDuration(uint64 newLockDuration) external onlyRole(OPERATOR_ROLE) {
        if (newLockDuration > MAX_LOCK_DURATION) revert LockTooLong(newLockDuration, MAX_LOCK_DURATION);
        emit LockDurationUpdated(lockDuration, newLockDuration);
        lockDuration = newLockDuration;
    }

    function setMinPlacement(uint256 newMinPlacement) external onlyRole(OPERATOR_ROLE) {
        emit MinPlacementUpdated(minPlacement, newMinPlacement);
        minPlacement = newMinPlacement;
    }

    /// @notice Halt new placements. Existing deposits stay withdrawable.
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /// @dev Value may only enter through `createPlacement`, so that every wei held
    ///      by this contract is attributable to a placement and the accounting can
    ///      never drift from the balance.
    receive() external payable {
        revert DirectPaymentRejected();
    }
}
