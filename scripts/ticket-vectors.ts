import { TypedDataEncoder } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { QUOTE_TYPES, SUBJECT_TYPES, domain } from "../frontend/lib/quote";
import type { PlacementQuoteV1 } from "../frontend/lib/quote";
import { hashSanitizedContext, hashTicket, subjectFromTicket } from "../frontend/lib/ticket";
import type { PlacementTicketV2, SanitizedContextV2 } from "../frontend/lib/ticket";
import { protocol } from "../frontend/lib/protocol";

/**
 * Regenerate shared/vectors/placement-ticket-v2.json.
 *
 * The vectors exist because PlacementTicketV2 is implemented twice - once with
 * ethers for the application, once with viem inside the confidential handler -
 * and two implementations of one hash will drift unless something fails when
 * they do. Both test suites read this file, so a change to either encoding
 * breaks the other runtime's tests immediately.
 *
 * Committing the file rather than computing it in each suite is the point: if
 * both suites derived the expected values from their own code, they would agree
 * with themselves and prove nothing. These numbers are checked in so a diff
 * shows up in review when an encoding changes.
 *
 *   npx hardhat run scripts/ticket-vectors.ts
 *
 * Every input is fixed, so re-running with no source change rewrites the same
 * bytes. The settlementContract is the deployed one because the application's
 * EIP-712 domain pins `verifyingContract` to it; a placeholder here would make
 * the two runtimes disagree on the quote digest for reasons unrelated to V2.
 */

const CONTEXT_SALT = `0x${"dd".repeat(32)}`;

const context: SanitizedContextV2 = {
  schemaVersion: 2,
  topics: ["DATASETS", "DEVELOPER_TOOLS", "MACHINE_LEARNING"],
  intent: "COMPARE_OPTIONS",
  commercialIntentBand: "HIGH",
  coarseLocale: "en-US",
  surface: "CHAT_ANSWER",
  ageEligibility: "ADULT_DECLARED",
  sensitiveClass: "NONE",
  personalization: false,
  salt: CONTEXT_SALT,
};

const contextCommitment = hashSanitizedContext(context);

const ticket: PlacementTicketV2 = {
  schemaVersion: 2,
  ticketNonce: `0x${"11".repeat(32)}`,
  campaignId: `0x${"22".repeat(32)}`,
  campaignRevisionHash: `0x${"33".repeat(32)}`,
  publisher: "0x9999999999999999999999999999999999999999",
  contextCommitment,
  productRefHash: `0x${"44".repeat(32)}`,
  contentHash: `0x${"bb".repeat(32)}`,
  policyCommitment: `0x${"ee".repeat(32)}`,
  policyProofLevel: 1,
  asset: protocol.asset,
  amount: "1000000",
  validUntil: "1800000000",
  chainId: String(protocol.chainId),
  settlementContract: protocol.settlement,
};

const ticketCommitment = hashTicket(ticket);
const subject = subjectFromTicket(ticket);
const subjectHash = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);

const quote: PlacementQuoteV1 = {
  schemaVersion: 1,
  campaignId: ticket.campaignId,
  subjectHash,
  payer: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
  recipient: "0x5555555555555555555555555555555555555555",
  asset: protocol.asset,
  amount: ticket.amount,
  // PlacementQuoteV1 predates the ticket and types this as a number.
  validUntil: Number(ticket.validUntil),
  nonce: `0x${"77".repeat(32)}`,
  chainId: protocol.chainId,
  settlementContract: protocol.settlement,
};

const receiptId = TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote);

const vectors = {
  $comment:
    "Cross-runtime vectors for PlacementTicketV2. Regenerate with `npx hardhat run scripts/ticket-vectors.ts`. Asserted by test/PlacementTicketV2.test.ts (ethers) and cre/placement-authorization/workflow.test.ts (viem).",
  contextSalt: CONTEXT_SALT,
  context: {
    schemaVersion: context.schemaVersion,
    topics: context.topics,
    intent: context.intent,
    commercialIntentBand: context.commercialIntentBand,
    coarseLocale: context.coarseLocale,
    surface: context.surface,
    ageEligibility: context.ageEligibility,
    sensitiveClass: context.sensitiveClass,
    personalization: context.personalization,
  },
  ticket,
  quote,
  expected: { contextCommitment, ticketCommitment, subjectHash, receiptId },
};

const target = resolve(__dirname, "../shared/vectors/placement-ticket-v2.json");
writeFileSync(target, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(`  contextCommitment ${contextCommitment}`);
console.log(`  ticketCommitment  ${ticketCommitment}`);
console.log(`  subjectHash       ${subjectHash}`);
console.log(`  receiptId         ${receiptId}`);
