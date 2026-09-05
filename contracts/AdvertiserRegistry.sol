// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAdvertiserRegistry} from "./interfaces/IAdvertiserRegistry.sol";
import {Canonical} from "./libraries/Canonical.sol";

/// @title AdvertiserRegistry
/// @notice Identity layer of Disclosed. An advertiser claims a brand name and a
///         domain; the claim stays unverified until a Chainlink CRE Confidential
///         Workflow resolves the DNS TXT challenge inside a TEE and the attestation
///         receiver calls `setVerified`.
/// @dev The contract never sees the challenge answer, only the boolean verdict that
///      leaves the enclave. Brand-name and domain uniqueness are enforced at
///      verification time, not at registration time: anyone may claim anything, but
///      only one address may ever hold a verified claim on a given name.
contract AdvertiserRegistry is AccessControl, IAdvertiserRegistry {
    /// @notice Held by the CRE attestation receiver. The only role that can flip
    ///         verification state.
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    mapping(address => Advertiser) private _advertisers;

    /// @notice nameHash (lowercased) => the address holding the verified claim.
    mapping(bytes32 => address) public nameOwner;

    /// @notice domainHash (lowercased) => the address holding the verified claim.
    mapping(bytes32 => address) public domainOwner;

    /// @notice Registration order, so indexers and the auditor view can enumerate.
    address[] private _advertiserList;

    /// @dev Bumped on every challenge issuance so a re-claim never reuses a string.
    uint256 private _challengeNonce;

    event AdvertiserRegistered(
        address indexed advertiser,
        string name,
        string domain,
        bytes32 indexed nameHash,
        bytes32 indexed domainHash,
        uint64 registeredAt
    );

    event ChallengeIssued(address indexed advertiser, bytes32 indexed domainHash, bytes32 challenge);

    event AdvertiserVerified(
        address indexed advertiser,
        bool verified,
        bytes32 indexed nameHash,
        bytes32 indexed domainHash,
        uint64 timestamp
    );

    event ClaimUpdated(address indexed advertiser, string name, string domain, bytes32 challenge);

    error AlreadyRegistered();
    error NotRegistered();
    error EmptyName();
    error EmptyDomain();
    error NameClaimedByAnother(address holder);
    error DomainClaimedByAnother(address holder);

    constructor(address admin, address attestor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (attestor != address(0)) {
            _grantRole(ATTESTOR_ROLE, attestor);
        }
    }

    // ---------------------------------------------------------------------
    // Advertiser actions
    // ---------------------------------------------------------------------

    /// @notice Create an unverified advertiser entry and receive a DNS challenge.
    /// @param name The brand name being claimed, e.g. "DeployCo".
    /// @param domain The domain the caller claims to control, e.g. "deployco.com".
    /// @return challenge The value to publish as a DNS TXT record on `domain`.
    function register(string calldata name, string calldata domain) external returns (bytes32 challenge) {
        if (_advertisers[msg.sender].status != Status.None) revert AlreadyRegistered();
        _requireNonEmpty(name, domain);

        challenge = _issueChallenge(msg.sender, domain);

        _advertisers[msg.sender] = Advertiser({
            name: name,
            domain: domain,
            challenge: challenge,
            registeredAt: uint64(block.timestamp),
            verifiedAt: 0,
            status: Status.Pending
        });
        _advertiserList.push(msg.sender);

        emit AdvertiserRegistered(msg.sender, name, domain, _hash(name), _hash(domain), uint64(block.timestamp));
        emit ChallengeIssued(msg.sender, _hash(domain), challenge);
    }

    /// @notice Amend the claimed name or domain. Any existing verification is
    ///         dropped and a fresh challenge is issued - a new domain must be
    ///         proved from scratch.
    function updateClaim(string calldata name, string calldata domain) external returns (bytes32 challenge) {
        Advertiser storage a = _advertisers[msg.sender];
        if (a.status == Status.None) revert NotRegistered();
        _requireNonEmpty(name, domain);

        _releaseClaims(msg.sender, a.name, a.domain);

        challenge = _issueChallenge(msg.sender, domain);

        a.name = name;
        a.domain = domain;
        a.challenge = challenge;
        a.verifiedAt = 0;
        a.status = Status.Pending;

        emit ClaimUpdated(msg.sender, name, domain, challenge);
        emit ChallengeIssued(msg.sender, _hash(domain), challenge);
    }

    // ---------------------------------------------------------------------
    // Attestation
    // ---------------------------------------------------------------------

    /// @notice Record the verdict of the confidential DNS check.
    /// @dev Callable only by the CRE attestation receiver. Passing `false` for an
    ///      advertiser that is currently verified revokes the claim and frees the
    ///      name and domain for a legitimate holder.
    function setVerified(address advertiser, bool verified) external onlyRole(ATTESTOR_ROLE) {
        Advertiser storage a = _advertisers[advertiser];
        if (a.status == Status.None) revert NotRegistered();

        bytes32 nameHash = _hashMemory(a.name);
        bytes32 domainHash = _hashMemory(a.domain);

        if (verified) {
            address nHolder = nameOwner[nameHash];
            if (nHolder != address(0) && nHolder != advertiser) revert NameClaimedByAnother(nHolder);

            address dHolder = domainOwner[domainHash];
            if (dHolder != address(0) && dHolder != advertiser) revert DomainClaimedByAnother(dHolder);

            nameOwner[nameHash] = advertiser;
            domainOwner[domainHash] = advertiser;

            a.status = Status.Verified;
            a.verifiedAt = uint64(block.timestamp);
        } else {
            _releaseClaims(advertiser, a.name, a.domain);
            a.status = Status.Revoked;
            a.verifiedAt = 0;
        }

        emit AdvertiserVerified(advertiser, verified, nameHash, domainHash, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isVerified(address advertiser) public view returns (bool) {
        return _advertisers[advertiser].status == Status.Verified;
    }

    function getAdvertiser(address advertiser) external view returns (Advertiser memory) {
        return _advertisers[advertiser];
    }

    function registeredAt(address advertiser) external view returns (uint64) {
        return _advertisers[advertiser].registeredAt;
    }

    function statusOf(address advertiser) external view returns (Status) {
        return _advertisers[advertiser].status;
    }

    function challengeOf(address advertiser) external view returns (bytes32) {
        return _advertisers[advertiser].challenge;
    }

    function advertiserCount() external view returns (uint256) {
        return _advertiserList.length;
    }

    function advertiserAt(uint256 index) external view returns (address) {
        return _advertiserList[index];
    }

    /// @notice Resolve a brand name to the address that has proved control of it.
    ///         Returns the zero address when nobody has - "not in registry", which
    ///         is a statement about this registry's own data and nothing more.
    function verifiedOwnerOfName(string calldata name) external view returns (address) {
        return nameOwner[_hash(name)];
    }

    function verifiedOwnerOfDomain(string calldata domain) external view returns (address) {
        return domainOwner[_hash(domain)];
    }

    /// @notice The canonical hash Disclosed uses for names and domains: ASCII
    ///         lowercased, then keccak256. Exposed so off-chain services agree.
    function canonicalHash(string calldata value) external pure returns (bytes32) {
        return _hash(value);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _issueChallenge(address advertiser, string calldata domain) private returns (bytes32) {
        unchecked {
            ++_challengeNonce;
        }
        return keccak256(
            abi.encode(address(this), block.chainid, advertiser, _hash(domain), _challengeNonce, block.timestamp)
        );
    }

    function _releaseClaims(address advertiser, string memory name, string memory domain) private {
        bytes32 nameHash = _hashMemory(name);
        bytes32 domainHash = _hashMemory(domain);
        if (nameOwner[nameHash] == advertiser) delete nameOwner[nameHash];
        if (domainOwner[domainHash] == advertiser) delete domainOwner[domainHash];
    }

    function _requireNonEmpty(string calldata name, string calldata domain) private pure {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(domain).length == 0) revert EmptyDomain();
    }

    function _hash(string calldata value) private pure returns (bytes32) {
        return Canonical.hash(value);
    }

    function _hashMemory(string memory value) private pure returns (bytes32) {
        return Canonical.hash(value);
    }
}
