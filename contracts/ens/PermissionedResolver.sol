// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAddrResolver, ITextResolver} from "../interfaces/IResolverProfiles.sol";

/// @title PermissionedResolver
/// @notice A resolver whose write permissions are role-based per name and per
///         record key - ENSv2 Enhanced Access Control applied to the one thing
///         Disclosed needs it for.
/// @dev The interesting property is not that the advertiser owns its name. It is
///      that owning the name does not confer the right to make claims about
///      yourself.
///
///      Keys are split in two:
///      - Reserved keys, those under the `disclosed.` prefix, hold assertions the
///        registry makes about an advertiser: verified or not, spend tier,
///        verification timestamp. Only a delegate explicitly granted that exact
///        key may write one. The name's owner cannot, ever. If the owner could,
///        an advertiser could simply write `disclosed.verified = true` and the
///        badge would be worthless.
///      - Every other key is ordinary profile data - url, description, avatar -
///        and belongs to the owner, who may also delegate individual keys.
///
///      Delegation is per (node, key, account), so the verification oracle can be
///      given exactly one record on exactly one name, and revoked in a single
///      transaction without disturbing anything else.
contract PermissionedResolver is AccessControl, IAddrResolver, ITextResolver {
    /// @notice Held by the subname registry: creates nodes and administers
    ///         delegation of reserved keys.
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    /// @notice Keys beginning with this prefix are registry assertions, not
    ///         profile data, and are never writable by the name's owner.
    string public constant RESERVED_PREFIX = "disclosed.";

    mapping(bytes32 => address) public nodeOwner;

    /// @dev node => keccak(key) => account => may write.
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) private _recordRole;

    mapping(bytes32 => mapping(string => string)) private _text;
    mapping(bytes32 => address) private _addr;

    event NodeInitialized(bytes32 indexed node, address indexed owner);
    event RecordRoleGranted(bytes32 indexed node, string key, address indexed account);
    event RecordRoleRevoked(bytes32 indexed node, string key, address indexed account);

    error NodeAlreadyInitialized(bytes32 node);
    error UnknownNode(bytes32 node);
    error NotNodeOwner(address caller, address owner);
    error ReservedKey(string key);
    error UnauthorizedRecordWrite(bytes32 node, string key, address account);
    error ZeroOwner();

    constructor(address admin, address controller) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (controller != address(0)) {
            _grantRole(CONTROLLER_ROLE, controller);
        }
    }

    // ---------------------------------------------------------------------
    // Node lifecycle
    // ---------------------------------------------------------------------

    /// @notice Bind a node to its owner. Called once, by the subname registry,
    ///         when a name is issued.
    function initializeNode(bytes32 node, address owner) external onlyRole(CONTROLLER_ROLE) {
        if (owner == address(0)) revert ZeroOwner();
        if (nodeOwner[node] != address(0)) revert NodeAlreadyInitialized(node);

        nodeOwner[node] = owner;
        _addr[node] = owner;

        emit NodeInitialized(node, owner);
        emit AddrChanged(node, owner);
    }

    // ---------------------------------------------------------------------
    // Enhanced Access Control - delegation scoped to a single record
    // ---------------------------------------------------------------------

    /// @notice Delegate the right to write exactly one record on exactly one name.
    /// @dev Reserved keys are administered by the controller, ordinary keys by the
    ///      name's owner. An advertiser therefore cannot grant itself the right to
    ///      write its own verification status.
    function grantRecordRole(bytes32 node, string calldata key, address account) external {
        _authorizeDelegation(node, key);
        _recordRole[node][keccak256(bytes(key))][account] = true;
        emit RecordRoleGranted(node, key, account);
    }

    /// @notice Withdraw a delegation. One transaction, one record, no side effects.
    function revokeRecordRole(bytes32 node, string calldata key, address account) external {
        _authorizeDelegation(node, key);
        _recordRole[node][keccak256(bytes(key))][account] = false;
        emit RecordRoleRevoked(node, key, account);
    }

    function hasRecordRole(bytes32 node, string calldata key, address account) external view returns (bool) {
        return _recordRole[node][keccak256(bytes(key))][account];
    }

    /// @notice Whether `account` may write `key` on `node`, by the same logic the
    ///         write path uses. Exposed so a UI can disable a field rather than
    ///         letting the transaction revert.
    function canWrite(bytes32 node, string calldata key, address account) external view returns (bool) {
        if (nodeOwner[node] == address(0)) return false;
        if (_recordRole[node][keccak256(bytes(key))][account]) return true;
        // Owners hold every ordinary key and no reserved one.
        return !_isReserved(key) && account == nodeOwner[node];
    }

    function isReservedKey(string calldata key) external pure returns (bool) {
        return _isReserved(key);
    }

    // ---------------------------------------------------------------------
    // Records
    // ---------------------------------------------------------------------

    function setText(bytes32 node, string calldata key, string calldata value) external {
        address owner = nodeOwner[node];
        if (owner == address(0)) revert UnknownNode(node);

        bool delegated = _recordRole[node][keccak256(bytes(key))][msg.sender];
        bool ownerMayWrite = msg.sender == owner && !_isReserved(key);
        if (!delegated && !ownerMayWrite) revert UnauthorizedRecordWrite(node, key, msg.sender);

        _text[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function setAddr(bytes32 node, address a) external {
        address owner = nodeOwner[node];
        if (owner == address(0)) revert UnknownNode(node);
        if (msg.sender != owner) revert NotNodeOwner(msg.sender, owner);

        _addr[node] = a;
        emit AddrChanged(node, a);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }

    function addr(bytes32 node) external view returns (address payable) {
        return payable(_addr[node]);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _authorizeDelegation(bytes32 node, string calldata key) private view {
        address owner = nodeOwner[node];
        if (owner == address(0)) revert UnknownNode(node);

        if (_isReserved(key)) {
            if (!hasRole(CONTROLLER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
                revert ReservedKey(key);
            }
        } else if (msg.sender != owner) {
            revert NotNodeOwner(msg.sender, owner);
        }
    }

    function _isReserved(string calldata key) private pure returns (bool) {
        bytes calldata k = bytes(key);
        bytes memory p = bytes(RESERVED_PREFIX);
        if (k.length < p.length) return false;
        for (uint256 i = 0; i < p.length; ++i) {
            if (k[i] != p[i]) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------------
    // ERC-165
    // ---------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IAddrResolver).interfaceId
            || interfaceId == type(ITextResolver).interfaceId || super.supportsInterface(interfaceId);
    }
}
