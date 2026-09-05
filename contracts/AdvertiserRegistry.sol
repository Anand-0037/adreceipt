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
///
///      That uniqueness check compares `Canonical.hash` keys, and those compare
///      bytes. So the claim itself has to be restricted to a byte range a reader
///      cannot be fooled by: names and domains are printable ASCII only, and a
///      domain must be a well-formed LDH host name. Without that gate a claim
///      carrying a Cyrillic U+0435 renders as "deployco" and hashes as something
///      else entirely, and two addresses end up verified on one brand. The rule is
///      deliberately narrow - it does not pretend to solve visual confusion inside
///      ASCII ("rn" against "m", "0" against "O"); it removes the whole-alphabet
///      homoglyph space and leaves the residue to the DNS proof and the UI.
contract AdvertiserRegistry is AccessControl, IAdvertiserRegistry {
    /// @notice Held by the CRE attestation receiver. The only role that can flip
    ///         verification state.
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    /// @notice Longest brand name a claim may carry. Published so a front-end can
    ///         apply the same rule before it spends the caller's gas.
    uint256 public constant MAX_NAME_LENGTH = 64;

    /// @notice Longest domain a claim may carry - the DNS limit, since anything
    ///         beyond it could never resolve the TXT challenge anyway.
    uint256 public constant MAX_DOMAIN_LENGTH = 253;

    /// @notice Longest single dot-separated label inside a domain.
    uint256 public constant MAX_LABEL_LENGTH = 63;

    uint8 private constant _SPACE = 0x20;
    uint8 private constant _HYPHEN = 0x2D;
    uint8 private constant _DOT = 0x2E;
    uint8 private constant _TILDE = 0x7E;

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
    error NameTooLong(uint256 length, uint256 maximum);
    error DomainTooLong(uint256 length, uint256 maximum);
    /// @dev Raised for any byte outside printable ASCII - which is every homoglyph.
    error InvalidNameCharacter(uint256 index, bytes1 character);
    error InvalidDomainCharacter(uint256 index, bytes1 character);
    /// @dev Printable, but spelled so it can be read as another claim: padded or
    ///      double-spaced names, empty or hyphen-edged domain labels.
    error MalformedName();
    error MalformedDomain();
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
        _requireValidName(name);
        _requireValidDomain(domain);

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
        _requireValidName(name);
        _requireValidDomain(domain);

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

    /// @dev A brand name is printable ASCII, 0x20 through 0x7E, with no padding and
    ///      no doubled space. Everything above 0x7E is a byte of a multi-byte UTF-8
    ///      sequence, and that is exactly where the lookalike alphabets live, so the
    ///      whole range goes. Interior single spaces stay - "DeployCo Cloud" is a
    ///      real brand name - but " DeployCo" and "Deploy  Co" do not, because they
    ///      render as an existing claim while hashing past it.
    function _requireValidName(string calldata name) private pure {
        bytes calldata b = bytes(name);
        if (b.length == 0) revert EmptyName();
        if (b.length > MAX_NAME_LENGTH) revert NameTooLong(b.length, MAX_NAME_LENGTH);
        if (uint8(b[0]) == _SPACE || uint8(b[b.length - 1]) == _SPACE) revert MalformedName();

        for (uint256 i = 0; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            if (c < _SPACE || c > _TILDE) revert InvalidNameCharacter(i, b[i]);
            // b[0] is known not to be a space, so i is never 0 on this branch.
            if (c == _SPACE && uint8(b[i - 1]) == _SPACE) revert MalformedName();
        }
    }

    /// @dev A domain is an LDH host name: letters, digits and hyphen, in labels
    ///      separated by dots. Case is folded by `Canonical.hash`, so only the shape
    ///      is checked here. The structural rules exist for the same reason the
    ///      character rule does - "deployco.com." and "deployco..com" name the host
    ///      that "deployco.com" names, and each would otherwise hash to a key of its
    ///      own and sit beside the real claim.
    ///
    ///      A punycode domain ("xn--dployco-8cf.com") is valid ASCII and is
    ///      accepted. It has to be: it is a real, separately registrable domain
    ///      whose owner can honestly answer the DNS challenge for it. What its
    ///      claimant cannot do is take the brand name it decodes to, because that
    ///      name is not ASCII and so never enters the registry.
    function _requireValidDomain(string calldata domain) private pure {
        bytes calldata b = bytes(domain);
        if (b.length == 0) revert EmptyDomain();
        if (b.length > MAX_DOMAIN_LENGTH) revert DomainTooLong(b.length, MAX_DOMAIN_LENGTH);

        uint256 labelLength = 0;
        uint256 dots = 0;

        for (uint256 i = 0; i < b.length; ++i) {
            uint8 c = uint8(b[i]);

            if (c == _DOT) {
                // An empty label is a leading dot, a trailing dot or "..", each of
                // which names the host some shorter spelling already names.
                if (labelLength == 0) revert MalformedDomain();
                if (uint8(b[i - 1]) == _HYPHEN) revert MalformedDomain();
                labelLength = 0;
                unchecked {
                    ++dots;
                }
                continue;
            }

            bool alphanumeric =
                (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39);
            if (!alphanumeric && c != _HYPHEN) revert InvalidDomainCharacter(i, b[i]);
            if (c == _HYPHEN && labelLength == 0) revert MalformedDomain();

            unchecked {
                ++labelLength;
            }
            if (labelLength > MAX_LABEL_LENGTH) revert MalformedDomain();
        }

        // A bare label holds no TXT record the workflow could resolve, and a
        // trailing dot or hyphen would leave a second spelling of the same host.
        if (dots == 0) revert MalformedDomain();
        if (labelLength == 0) revert MalformedDomain();
        if (uint8(b[b.length - 1]) == _HYPHEN) revert MalformedDomain();
    }

    function _hash(string calldata value) private pure returns (bytes32) {
        return Canonical.hash(value);
    }

    function _hashMemory(string memory value) private pure returns (bytes32) {
        return Canonical.hash(value);
    }
}
