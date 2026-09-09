import { TypedDataEncoder, getAddress, verifyTypedData } from "ethers";
import { QUOTE_TYPES, SUBJECT_TYPES, domain } from "./quote";
import type { PlacementQuoteV1, SignedQuote, SubjectV1 } from "./quote";
import { POLICY_PROOF_LEVEL, hashTicket, parseTicket } from "./ticket";
import type { PlacementTicketV2 } from "./ticket";

/**
 * The review packet a human reads before any money moves.
 *
 * This builds, and only builds. It opens no RPC connection, signs nothing and
 * broadcasts nothing - given the same inputs it returns the same bytes, so two
 * reviewers can diff their packets and a packet can be attached to a PR.
 *
 * Its real job is to be the one place where an authorisation decision is
 * allowed to become a settlement request. Everything below fails closed: an
 * ineligible decision, a decision about a different ticket, a signature from
 * the wrong publisher and a ticket whose commitment does not reproduce the
 * placementId all raise, so there is no path from "the enclave said no" to a
 * prepared transaction.
 */

/**
 * What the confidential handler decided, as read back from its report.
 *
 * This mirrors the public fields of the CRE report and nothing else. The
 * allowlist, bid ceiling, allowed topics and both salts are not here because
 * they never leave the enclave.
 */
export interface AuthorizationResult {
  eligible: boolean;
  ticketCommitment: string;
  quoteId: string;
  campaignId: string;
  campaignRevisionHash: string;
  subjectHash: string;
  contextCommitment: string;
  policyCommitment: string;
  policyProofLevel: number;
}

export interface PreflightPacket {
  /** Always CRE_SIMULATED here. See `assertHonestProofLevel`. */
  proofLevel: "CRE_SIMULATED";
  ticket: PlacementTicketV2;
  ticketCommitment: string;
  subject: SubjectV1;
  quote: PlacementQuoteV1;
  publisherSignature: string;
  receiptId: string;
  hashes: {
    subjectHash: string;
    contextCommitment: string;
    policyCommitment: string;
    campaignRevisionHash: string;
  };
  payment: {
    payer: string;
    recipient: string;
    asset: string;
    amount: string;
    /** Approve exactly this, never an unlimited allowance. */
    allowanceRequired: string;
    chainId: number;
    settlementContract: string;
  };
  expiry: { validUntil: number; secondsRemaining: number };
  nonce: string;
  /** Stated so a reader is never left inferring it from the packet's existence. */
  broadcast: false;
}

/**
 * Refuse to prepare anything that claims a proof we cannot produce.
 *
 * The CRE CLI account is authenticated but deployment access is not enabled, so
 * no run in this repository is backed by a live DON. A packet that said
 * CRE_ENFORCED would be a claim about hardware that nothing here can support -
 * and the temptation to paper over it with a backend signature or a copied
 * simulation result is exactly what this check exists to block.
 */
function assertHonestProofLevel(level: number): void {
  if (level === POLICY_PROOF_LEVEL.CRE_ENFORCED) {
    throw new Error(
      "This authorization claims CRE_ENFORCED. Deployment access is not enabled, so no live DON attested it. Preparing a settlement from this claim would misrepresent the proof.",
    );
  }
  if (level !== POLICY_PROOF_LEVEL.CRE_SIMULATED) {
    throw new Error(`Unknown policyProofLevel ${level}.`);
  }
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Build the packet, or explain precisely why it cannot be built.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the packet is
 * reproducible and the expiry check is testable.
 */
export function buildPreflight(input: {
  authorization: AuthorizationResult;
  ticket: PlacementTicketV2;
  signed: SignedQuote;
  now: number;
}): PreflightPacket {
  const { authorization, signed, now } = input;
  const ticket = parseTicket(input.ticket);
  const { subject, quote, signature, receiptId } = signed;

  assertHonestProofLevel(authorization.policyProofLevel);

  // The decision itself. Checked first so an ineligible result never gets far
  // enough to produce a partially-built packet.
  if (!authorization.eligible) {
    throw new Error(
      "The confidential policy declined this placement. No settlement request may be prepared from an ineligible authorization.",
    );
  }

  // The decision has to be about *this* ticket. Without these, an eligible
  // result for some other placement would authorise this one.
  const ticketCommitment = hashTicket(ticket);
  if (!sameHex(authorization.ticketCommitment, ticketCommitment)) {
    throw new Error("The authorization was issued for a different placement ticket.");
  }
  if (!sameHex(authorization.campaignRevisionHash, ticket.campaignRevisionHash)) {
    throw new Error("The authorization names a different campaign revision than the ticket.");
  }
  if (!sameHex(authorization.contextCommitment, ticket.contextCommitment)) {
    throw new Error("The authorization names a different context commitment than the ticket.");
  }
  if (!sameHex(authorization.policyCommitment, ticket.policyCommitment)) {
    throw new Error("The authorization names a different policy commitment than the ticket.");
  }

  // The ticket has to be the one the subject was built from.
  if (!sameHex(subject.placementId, ticketCommitment)) {
    throw new Error("The subject's placementId is not this ticket's commitment.");
  }
  if (
    !sameHex(subject.publisher, ticket.publisher) ||
    !sameHex(subject.productRefHash, ticket.productRefHash) ||
    !sameHex(subject.contentHash, ticket.contentHash)
  ) {
    throw new Error("The subject does not match the ticket it commits to.");
  }

  // And the quote has to be the one the enclave decided on.
  const subjectHash = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);
  if (
    !sameHex(subjectHash, quote.subjectHash) ||
    !sameHex(authorization.subjectHash, subjectHash)
  ) {
    throw new Error("The subject hash does not match the quote and the authorization.");
  }
  if (!sameHex(authorization.campaignId, quote.campaignId)) {
    throw new Error("The authorization names a different campaign than the quote.");
  }
  if (
    !sameHex(ticket.asset, quote.asset) ||
    BigInt(ticket.amount) !== BigInt(quote.amount) ||
    BigInt(ticket.validUntil) !== BigInt(quote.validUntil) ||
    !sameHex(ticket.campaignId, quote.campaignId)
  ) {
    throw new Error("The ticket and the quote disagree on asset, amount, expiry or campaign.");
  }

  const digest = TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote);
  if (!sameHex(digest, receiptId)) {
    throw new Error("The supplied receipt ID does not match the quote.");
  }
  if (!sameHex(authorization.quoteId, digest)) {
    throw new Error("The authorization was issued for a different quote.");
  }

  // A quote nobody signed is a price nobody offered.
  const recovered = verifyTypedData(domain(quote.chainId), QUOTE_TYPES as never, quote, signature);
  if (getAddress(recovered) !== getAddress(subject.publisher)) {
    throw new Error("The signature does not belong to the named publisher.");
  }

  if (quote.validUntil <= now) {
    throw new Error("The quote has expired. Ask the publisher for a fresh one.");
  }

  return {
    proofLevel: "CRE_SIMULATED",
    ticket,
    ticketCommitment,
    subject,
    quote,
    publisherSignature: signature,
    receiptId: digest,
    hashes: {
      subjectHash,
      contextCommitment: ticket.contextCommitment,
      policyCommitment: ticket.policyCommitment,
      campaignRevisionHash: ticket.campaignRevisionHash,
    },
    payment: {
      payer: getAddress(quote.payer),
      recipient: getAddress(quote.recipient),
      asset: getAddress(quote.asset),
      amount: quote.amount,
      allowanceRequired: quote.amount,
      chainId: quote.chainId,
      settlementContract: getAddress(quote.settlementContract),
    },
    expiry: { validUntil: quote.validUntil, secondsRemaining: quote.validUntil - now },
    nonce: quote.nonce,
    broadcast: false,
  };
}

/**
 * Stable JSON, so two reviewers produce byte-identical packets.
 *
 * Key order in an object literal is insertion order, which is easy to perturb
 * by editing this file. Sorting every level means the serialised packet is a
 * function of its values alone and stays diffable across revisions.
 */
export function serialisePreflight(packet: PreflightPacket): string {
  return JSON.stringify(sortDeep(packet), null, 2);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value !== "object" || value === null) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
