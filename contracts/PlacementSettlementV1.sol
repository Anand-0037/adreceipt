// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Settles one publisher-authorized recommendation placement without custody.
contract PlacementSettlementV1 is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant SCHEMA_VERSION = 1;

    bytes32 public constant SUBJECT_V1_TYPEHASH = keccak256(
        "SubjectV1(address publisher,bytes32 placementId,bytes32 productRefHash,bytes32 contentHash,uint16 disclosureVersion)"
    );
    bytes32 public constant PLACEMENT_QUOTE_V1_TYPEHASH = keccak256(
        "PlacementQuoteV1(uint16 schemaVersion,bytes32 campaignId,bytes32 subjectHash,address payer,address recipient,address asset,uint256 amount,uint64 validUntil,bytes32 nonce,uint256 chainId,address settlementContract)"
    );

    struct SubjectV1 {
        address publisher;
        bytes32 placementId;
        bytes32 productRefHash;
        bytes32 contentHash;
        uint16 disclosureVersion;
    }

    struct PlacementQuoteV1 {
        uint16 schemaVersion;
        bytes32 campaignId;
        bytes32 subjectHash;
        address payer;
        address recipient;
        address asset;
        uint256 amount;
        uint64 validUntil;
        bytes32 nonce;
        uint256 chainId;
        address settlementContract;
    }

    address public immutable settlementAsset;

    mapping(bytes32 quoteId => bool consumed) public consumedQuotes;
    mapping(bytes32 publisherNonceKey => bool consumed) public consumedNonces;

    event ReceiptCreated(
        bytes32 indexed receiptId,
        bytes32 indexed campaignId,
        bytes32 indexed subjectHash,
        address publisher,
        address payer,
        address recipient,
        address asset,
        uint256 amount,
        uint64 settledAt,
        uint16 schemaVersion
    );

    error ZeroAddress();
    error InvalidSubject();
    error InvalidQuote();
    error UnsupportedSchema(uint16 provided);
    error SubjectMismatch(bytes32 expected, bytes32 actual);
    error WrongPayer(address caller, address expected);
    error WrongAsset(address provided, address expected);
    error WrongChain(uint256 provided, uint256 expected);
    error WrongSettlementContract(address provided, address expected);
    error QuoteExpired(uint64 validUntil, uint64 currentTime);
    error InvalidPublisherSignature(address recovered, address expected);
    error QuoteAlreadyConsumed(bytes32 quoteId);
    error NonceAlreadyConsumed(bytes32 nonceKey);
    error NonExactTransfer(uint256 expected, uint256 received);
    constructor(address settlementAsset_) EIP712("AdReceipt", "1") {
        if (settlementAsset_ == address(0)) revert ZeroAddress();
        settlementAsset = settlementAsset_;
    }

    function hashSubject(SubjectV1 calldata subject) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SUBJECT_V1_TYPEHASH,
                subject.publisher,
                subject.placementId,
                subject.productRefHash,
                subject.contentHash,
                subject.disclosureVersion
            )
        );
    }

    function hashQuote(PlacementQuoteV1 calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PLACEMENT_QUOTE_V1_TYPEHASH,
                    quote.schemaVersion,
                    quote.campaignId,
                    quote.subjectHash,
                    quote.payer,
                    quote.recipient,
                    quote.asset,
                    quote.amount,
                    quote.validUntil,
                    quote.nonce,
                    quote.chainId,
                    quote.settlementContract
                )
            )
        );
    }

    function nonceKey(address publisher, bytes32 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(publisher, nonce));
    }

    function settlePlacement(
        SubjectV1 calldata subject,
        PlacementQuoteV1 calldata quote,
        bytes calldata publisherSignature
    ) external nonReentrant returns (bytes32 receiptId) {
        if (
            subject.publisher == address(0) || subject.placementId == bytes32(0)
                || subject.productRefHash == bytes32(0) || subject.contentHash == bytes32(0)
                || subject.disclosureVersion == 0
        ) revert InvalidSubject();
        if (
            quote.campaignId == bytes32(0) || quote.subjectHash == bytes32(0) || quote.payer == address(0)
                || quote.recipient == address(0) || quote.amount == 0 || quote.nonce == bytes32(0)
        ) revert InvalidQuote();
        if (quote.schemaVersion != SCHEMA_VERSION) revert UnsupportedSchema(quote.schemaVersion);

        bytes32 actualSubjectHash = hashSubject(subject);
        if (quote.subjectHash != actualSubjectHash) revert SubjectMismatch(quote.subjectHash, actualSubjectHash);
        if (msg.sender != quote.payer) revert WrongPayer(msg.sender, quote.payer);

        if (quote.asset != settlementAsset) revert WrongAsset(quote.asset, settlementAsset);
        if (quote.chainId != block.chainid) revert WrongChain(quote.chainId, block.chainid);
        if (quote.settlementContract != address(this)) {
            revert WrongSettlementContract(quote.settlementContract, address(this));
        }
        if (block.timestamp > quote.validUntil) revert QuoteExpired(quote.validUntil, uint64(block.timestamp));

        receiptId = hashQuote(quote);
        address recovered = ECDSA.recover(receiptId, publisherSignature);
        if (recovered != subject.publisher) revert InvalidPublisherSignature(recovered, subject.publisher);
        if (consumedQuotes[receiptId]) revert QuoteAlreadyConsumed(receiptId);

        bytes32 publisherNonceKey = nonceKey(subject.publisher, quote.nonce);
        if (consumedNonces[publisherNonceKey]) revert NonceAlreadyConsumed(publisherNonceKey);

        consumedQuotes[receiptId] = true;
        consumedNonces[publisherNonceKey] = true;

        IERC20 token = IERC20(settlementAsset);
        uint256 balanceBefore = token.balanceOf(quote.recipient);
        token.safeTransferFrom(msg.sender, quote.recipient, quote.amount);
        uint256 received = token.balanceOf(quote.recipient) - balanceBefore;
        if (received != quote.amount) revert NonExactTransfer(quote.amount, received);

        _emitReceipt(subject.publisher, quote, receiptId);
    }

    function _emitReceipt(address publisher, PlacementQuoteV1 calldata quote, bytes32 receiptId) private {
        emit ReceiptCreated(
            receiptId,
            quote.campaignId,
            quote.subjectHash,
            publisher,
            quote.payer,
            quote.recipient,
            quote.asset,
            quote.amount,
            uint64(block.timestamp),
            quote.schemaVersion
        );
    }
}
