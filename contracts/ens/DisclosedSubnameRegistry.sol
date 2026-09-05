// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IAdvertiserRegistry} from "../interfaces/IAdvertiserRegistry.sol";
import {ITierAttestation} from "../interfaces/ITierAttestation.sol";
import {PermissionedResolver} from "./PermissionedResolver.sol";

/// @title DisclosedSubnameRegistry
/// @notice Issues one subname per verified advertiser under a parent name -
///         `deployco.disclosed.eth` - and keeps the registry's assertions about
///         that advertiser in text records on a Permissioned Resolver.
/// @dev The point of putting identity here rather than on a raw wallet is that
///      reputation must not be resettable. So the binding is permanent by
///      construction: there is no transfer, no burn, no release and no
///      re-assignment. An advertiser has at most one name for the life of the
///      registry, and a name has exactly one advertiser, forever. Losing
///      verification changes what the records say; it does not hand back a clean
///      slate.
///
///      `syncRecords` is deliberately permissionless. Every value it writes is
///      derived from state that is already public on the advertiser registry and
///      the tier attestation, so letting anyone refresh the mirror costs nothing
///      and removes the operator from the path. This contract holds narrow,
///      per-key delegation on each node it issues, which is the only reason it
///      can write those records at all - and the advertiser, despite owning the
///      name, cannot write them itself.
contract DisclosedSubnameRegistry is AccessControl {
    using Strings for uint256;

    /// @notice May issue names. Held by an operator, or by an automation key.
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    // Reserved record keys. Writable only through this contract's delegation.
    string public constant KEY_VERIFIED = "disclosed.verified";
    string public constant KEY_DOMAIN = "disclosed.domain";
    string public constant KEY_REGISTERED_AT = "disclosed.registered-at";
    string public constant KEY_VERIFIED_AT = "disclosed.verified-at";
    string public constant KEY_TIER = "disclosed.tier";

    IAdvertiserRegistry public immutable advertisers;
    ITierAttestation public immutable tiers;
    PermissionedResolver public immutable resolver;

    /// @notice Namehash of the parent, e.g. namehash("disclosed.eth").
    bytes32 public immutable parentNode;

    /// @notice Human-readable parent, used to render the full name on-chain.
    string public parentName;

    struct Subname {
        address advertiser;
        string label;
        uint64 issuedAt;
    }

    mapping(bytes32 => Subname) private _subnames;
    mapping(address => bytes32) public nodeOf;
    mapping(bytes32 => bool) public labelTaken;

    bytes32[] private _issued;

    event SubnameIssued(
        bytes32 indexed node, address indexed advertiser, string label, string fullName, uint64 issuedAt
    );

    event RecordsSynced(
        bytes32 indexed node, address indexed advertiser, bool verified, ITierAttestation.Tier tier
    );

    error AdvertiserNotVerified(address advertiser);
    error AdvertiserAlreadyNamed(address advertiser, bytes32 node);
    error LabelTaken(string label);
    error InvalidLabel(string label);
    error NoSubname(address advertiser);

    constructor(
        address admin,
        IAdvertiserRegistry advertisers_,
        ITierAttestation tiers_,
        PermissionedResolver resolver_,
        bytes32 parentNode_,
        string memory parentName_
    ) {
        advertisers = advertisers_;
        tiers = tiers_;
        resolver = resolver_;
        parentNode = parentNode_;
        parentName = parentName_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Issuance
    // ---------------------------------------------------------------------

    /// @notice Issue `label`.`parentName` to a verified advertiser.
    /// @dev Only issued to an advertiser that has already proved domain control.
    ///      The name is the reward for verification, not a step towards it.
    function issue(string calldata label, address advertiser)
        external
        onlyRole(ISSUER_ROLE)
        returns (bytes32 node)
    {
        if (!advertisers.isVerified(advertiser)) revert AdvertiserNotVerified(advertiser);
        if (nodeOf[advertiser] != bytes32(0)) {
            revert AdvertiserAlreadyNamed(advertiser, nodeOf[advertiser]);
        }
        if (!_validLabel(label)) revert InvalidLabel(label);

        bytes32 labelHash = keccak256(bytes(label));
        if (labelTaken[labelHash]) revert LabelTaken(label);

        node = keccak256(abi.encodePacked(parentNode, labelHash));

        labelTaken[labelHash] = true;
        nodeOf[advertiser] = node;
        _subnames[node] = Subname({advertiser: advertiser, label: label, issuedAt: uint64(block.timestamp)});
        _issued.push(node);

        // The advertiser owns the name and its ordinary profile records...
        resolver.initializeNode(node, advertiser);

        // ...while this contract holds exactly five reserved keys on it, and
        // nothing else. Each one is revocable individually.
        resolver.grantRecordRole(node, KEY_VERIFIED, address(this));
        resolver.grantRecordRole(node, KEY_DOMAIN, address(this));
        resolver.grantRecordRole(node, KEY_REGISTERED_AT, address(this));
        resolver.grantRecordRole(node, KEY_VERIFIED_AT, address(this));
        resolver.grantRecordRole(node, KEY_TIER, address(this));

        IAdvertiserRegistry.Advertiser memory a = advertisers.getAdvertiser(advertiser);
        resolver.setText(node, KEY_DOMAIN, a.domain);
        resolver.setText(node, KEY_REGISTERED_AT, uint256(a.registeredAt).toString());

        emit SubnameIssued(node, advertiser, label, fullNameOf(node), uint64(block.timestamp));

        _sync(node, advertiser);
    }

    // ---------------------------------------------------------------------
    // Mirroring on-chain truth into records
    // ---------------------------------------------------------------------

    /// @notice Refresh the reserved records from the registry and the tier
    ///         attestation. Callable by anyone: every input is already public,
    ///         and nothing here is a judgement.
    function syncRecords(address advertiser) external {
        bytes32 node = nodeOf[advertiser];
        if (node == bytes32(0)) revert NoSubname(advertiser);
        _sync(node, advertiser);
    }

    function _sync(bytes32 node, address advertiser) private {
        bool verified = advertisers.isVerified(advertiser);
        ITierAttestation.Tier tier = tiers.currentTierOf(advertiser);
        IAdvertiserRegistry.Advertiser memory a = advertisers.getAdvertiser(advertiser);

        resolver.setText(node, KEY_VERIFIED, verified ? "true" : "false");
        resolver.setText(node, KEY_VERIFIED_AT, uint256(a.verifiedAt).toString());
        resolver.setText(node, KEY_TIER, _tierLabel(tier));

        emit RecordsSynced(node, advertiser, verified, tier);
    }

    /// @dev Lowercase words rather than an integer, so a resolver lookup is
    ///      readable without the enum to hand.
    function _tierLabel(ITierAttestation.Tier tier) private pure returns (string memory) {
        if (tier == ITierAttestation.Tier.Minimal) return "minimal";
        if (tier == ITierAttestation.Tier.Moderate) return "moderate";
        if (tier == ITierAttestation.Tier.Major) return "major";
        return "none";
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSubname(bytes32 node) external view returns (Subname memory) {
        return _subnames[node];
    }

    function advertiserOf(bytes32 node) external view returns (address) {
        return _subnames[node].advertiser;
    }

    function labelOf(bytes32 node) external view returns (string memory) {
        return _subnames[node].label;
    }

    function fullNameOf(bytes32 node) public view returns (string memory) {
        Subname storage s = _subnames[node];
        if (s.advertiser == address(0)) return "";
        return string.concat(s.label, ".", parentName);
    }

    /// @notice The name an advertiser will always be known by here, verified or not.
    function nameOfAdvertiser(address advertiser) external view returns (string memory) {
        return fullNameOf(nodeOf[advertiser]);
    }

    function nodeForLabel(string calldata label) external view returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    function issuedCount() external view returns (uint256) {
        return _issued.length;
    }

    function issuedAt(uint256 index) external view returns (bytes32) {
        return _issued[index];
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Lowercase a-z, 0-9 and internal hyphens, 3 to 63 characters. Narrow on
    ///      purpose: a label that can contain uppercase or unicode is a label that
    ///      can be made to look like someone else's.
    function _validLabel(string calldata label) private pure returns (bool) {
        bytes calldata b = bytes(label);
        if (b.length < 3 || b.length > 63) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;

        for (uint256 i = 0; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7A) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == "-";
            if (!ok) return false;
        }
        return true;
    }
}
