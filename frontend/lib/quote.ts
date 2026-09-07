"use client";

import { BrowserProvider, TypedDataEncoder, hexlify, randomBytes, id } from "ethers";
import { injected } from "./wallet";

/**
 * Publisher-side quote construction and signing.
 *
 * The publisher's signature is what makes a receipt mean anything: it commits,
 * before any money moves, to the exact recommendation text, the price, who may
 * pay and who gets paid. A payment without it proves only that funds moved.
 *
 * Every field name and its order must match PLACEMENT_QUOTE_V1_TYPEHASH in the
 * contract exactly - EIP-712 hashes the type string, so a renamed or reordered
 * field silently produces a signature that recovers to the wrong address.
 */

export const SETTLEMENT = "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576";
export const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const SCHEMA_VERSION = 1;

export const SUBJECT_TYPES = {
  SubjectV1: [
    { name: "publisher", type: "address" },
    { name: "placementId", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "disclosureVersion", type: "uint16" },
  ],
} as const;

export const QUOTE_TYPES = {
  PlacementQuoteV1: [
    { name: "schemaVersion", type: "uint16" },
    { name: "campaignId", type: "bytes32" },
    { name: "subjectHash", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "settlementContract", type: "address" },
  ],
} as const;

export interface SubjectV1 {
  publisher: string;
  placementId: string;
  productRefHash: string;
  contentHash: string;
  disclosureVersion: number;
}

export interface PlacementQuoteV1 {
  schemaVersion: number;
  campaignId: string;
  subjectHash: string;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  validUntil: number;
  nonce: string;
  chainId: number;
  settlementContract: string;
}

export interface SignedQuote {
  subject: SubjectV1;
  quote: PlacementQuoteV1;
  signature: string;
  /** The EIP-712 digest, which is also the receiptId the settlement emits. */
  receiptId: string;
}

/** Domain must match `EIP712("AdReceipt", "1")` in the contract. */
export function domain(chainId: number) {
  return {
    name: "AdReceipt",
    version: "1",
    chainId,
    verifyingContract: SETTLEMENT,
  };
}

/**
 * Build the subject from what the reader will actually see.
 *
 * `contentHash` hashes the recommendation text verbatim. That is the link that
 * lets a reader check the words in front of them against what was paid for -
 * so the text hashed here must be the text displayed, character for character.
 */
export function buildSubject(input: {
  publisher: string;
  placementLabel: string;
  productRef: string;
  recommendationText: string;
}): SubjectV1 {
  return {
    publisher: input.publisher,
    placementId: id(input.placementLabel.trim()),
    productRefHash: id(input.productRef.trim()),
    contentHash: id(input.recommendationText.trim()),
    disclosureVersion: 1,
  };
}

export function hashSubject(subject: SubjectV1): string {
  return TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);
}

export function buildQuote(input: {
  subject: SubjectV1;
  campaignLabel: string;
  payer: string;
  recipient: string;
  /** Whole USDC, e.g. "0.1". Converted to 6-decimal base units. */
  amountUsdc: string;
  chainId: number;
  validForSeconds?: number;
}): PlacementQuoteV1 {
  const units = Math.round(Number(input.amountUsdc) * 1e6);
  return {
    schemaVersion: SCHEMA_VERSION,
    campaignId: id(input.campaignLabel.trim()),
    subjectHash: hashSubject(input.subject),
    payer: input.payer,
    recipient: input.recipient,
    asset: USDC,
    amount: String(units),
    // Short by default. A quote that lives for hours is a price the publisher
    // can no longer withdraw.
    validUntil: Math.floor(Date.now() / 1000) + (input.validForSeconds ?? 3600),
    nonce: hexlify(randomBytes(32)),
    chainId: input.chainId,
    settlementContract: SETTLEMENT,
  };
}

/** Sign as the publisher. The wallet must be the `subject.publisher`. */
export async function signQuote(
  subject: SubjectV1,
  quote: PlacementQuoteV1,
): Promise<SignedQuote> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");

  const signer = await new BrowserProvider(eth).getSigner();
  const signerAddress = await signer.getAddress();

  if (signerAddress.toLowerCase() !== subject.publisher.toLowerCase()) {
    throw new Error(
      `This wallet is ${signerAddress}, but the quote names ${subject.publisher} as publisher. The signature would recover to the wrong address and settlement would revert.`,
    );
  }

  const typed = domain(quote.chainId);
  const signature = await signer.signTypedData(typed, QUOTE_TYPES as never, quote);

  return {
    subject,
    quote,
    signature,
    receiptId: TypedDataEncoder.hash(typed, QUOTE_TYPES as never, quote),
  };
}

/** Everything an advertiser needs to settle, as one pasteable blob. */
export function serialise(signed: SignedQuote): string {
  return JSON.stringify(signed, null, 2);
}
