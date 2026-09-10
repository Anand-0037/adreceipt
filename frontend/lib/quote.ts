"use client";

import {
  BrowserProvider,
  TypedDataEncoder,
  getAddress,
  hexlify,
  id,
  isHexString,
  parseUnits,
  randomBytes,
  verifyTypedData,
} from "ethers";
import { injected } from "./wallet";
import { protocol } from "./protocol";

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

export const SETTLEMENT = protocol.settlement;
export const USDC = protocol.asset;
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
    contentHash: id(input.recommendationText),
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
  const payer = getAddress(input.payer);
  const recipient = getAddress(input.recipient);
  const units = parseUnits(input.amountUsdc, 6);
  if (units <= 0n) throw new Error("The placement price must be greater than zero.");
  if (input.chainId !== protocol.chainId)
    throw new Error(`Placement quotes are currently ${protocol.network}-only.`);
  return {
    schemaVersion: SCHEMA_VERSION,
    campaignId: id(input.campaignLabel.trim()),
    subjectHash: hashSubject(input.subject),
    payer,
    recipient,
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

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate every signed field before a payer grants an ERC-20 allowance. */
export function parseSignedQuote(raw: string, now = Math.floor(Date.now() / 1000)): SignedQuote {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("That is not valid JSON. Paste the complete signed quote.");
  }
  if (!object(value) || !object(value.subject) || !object(value.quote)) {
    throw new Error("Missing subject or quote. Paste the complete signed quote.");
  }
  const candidate = value as unknown as SignedQuote;
  const { subject, quote, signature, receiptId } = candidate;
  try {
    getAddress(subject.publisher);
    getAddress(quote.payer);
    getAddress(quote.recipient);
    getAddress(quote.asset);
    getAddress(quote.settlementContract);
  } catch {
    throw new Error("The signed quote contains an invalid address.");
  }
  if (
    !isHexString(subject.placementId, 32) ||
    !isHexString(subject.productRefHash, 32) ||
    !isHexString(subject.contentHash, 32) ||
    !isHexString(quote.campaignId, 32) ||
    !isHexString(quote.subjectHash, 32) ||
    !isHexString(quote.nonce, 32) ||
    !isHexString(signature, 65) ||
    !isHexString(receiptId, 32)
  ) {
    throw new Error("The signed quote contains a malformed hash or signature.");
  }
  if (![1, 2].includes(subject.disclosureVersion) || quote.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("This quote uses an unsupported AdReceipt schema.");
  }
  if (quote.chainId !== protocol.chainId)
    throw new Error(`This quote is not for ${protocol.network}.`);
  if (getAddress(quote.asset) !== getAddress(USDC))
    throw new Error("This quote does not use Circle test USDC.");
  if (getAddress(quote.settlementContract) !== getAddress(SETTLEMENT)) {
    throw new Error("This quote targets a different settlement contract.");
  }
  if (hashSubject(subject) !== quote.subjectHash) {
    throw new Error("The recommendation subject does not match the signed quote.");
  }
  let amount: bigint;
  try {
    amount = BigInt(quote.amount);
  } catch {
    throw new Error("The quote amount is invalid.");
  }
  if (amount <= 0n) throw new Error("The quote amount must be greater than zero.");
  if (!Number.isSafeInteger(quote.validUntil) || quote.validUntil <= now) {
    throw new Error("This quote has expired. Ask the publisher for a fresh one.");
  }
  const digest = TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote);
  if (digest !== receiptId) throw new Error("The supplied receipt ID does not match the quote.");
  const recovered = verifyTypedData(domain(quote.chainId), QUOTE_TYPES as never, quote, signature);
  if (getAddress(recovered) !== getAddress(subject.publisher)) {
    throw new Error("The signature does not belong to the named publisher.");
  }
  return candidate;
}

/** Sign as the publisher. The wallet must be the `subject.publisher`. */
export async function signQuote(subject: SubjectV1, quote: PlacementQuoteV1): Promise<SignedQuote> {
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
