import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashSanitizedContext, hashTicket, subjectFromTicket } from "../frontend/lib/ticket";
import type { PlacementTicketV2, SanitizedContextV2 } from "../frontend/lib/ticket";
import { protocol } from "../frontend/lib/protocol";
import { QUOTE_TYPES, SUBJECT_TYPES, domain } from "../frontend/lib/quote";
import { TypedDataEncoder } from "ethers";

/**
 * Regenerate the placement-authorization simulation fixtures.
 *
 *   npx hardhat run scripts/cre-placement-fixture.ts
 *
 * Four artifacts have to agree exactly or `cre:simulate` fails with a binding
 * error that says nothing useful:
 *
 *   - the fixture policy JSON in simulation.env.example
 *   - the ticket's policyCommitment, derived from that JSON and its salt
 *   - the ticket's contextCommitment, derived from the context and a second salt
 *   - config.staging.json / config.ineligible.json, whose subjectHash and
 *     quoteId are downstream of the ticket commitment
 *
 * Keeping them in sync by hand means a one-character edit to the policy changes
 * a hash three files away. So this script owns all four. In particular the
 * policy JSON is serialised here rather than retyped: the commitment is a hash
 * over the exact string, so key order is load-bearing.
 *
 * These are public test fixtures. A real campaign policy never leaves the
 * advertiser, and its salts are never published.
 */

const abi = AbiCoder.defaultAbiCoder();

/** Key order is part of the commitment. Do not reorder without regenerating. */
const policy = {
  allowedProductRefHashes: [`0x${"44".repeat(32)}`],
  maxBid: "1000000",
  campaignId: `0x${"22".repeat(32)}`,
  campaignRevisionHash: `0x${"33".repeat(32)}`,
  allowedTopics: ["DATASETS", "DEVELOPER_TOOLS", "MACHINE_LEARNING"],
  allowedIntents: ["COMPARE_OPTIONS", "SOLVE_PROBLEM"],
  publisher: "0x9999999999999999999999999999999999999999",
  payer: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
  recipient: "0x5555555555555555555555555555555555555555",
  asset: protocol.asset,
  chainId: String(protocol.chainId),
  settlementContract: protocol.settlement,
  commitmentSalt: `0x${"cc".repeat(32)}`,
  contextSalt: `0x${"dd".repeat(32)}`,
};

const rawPolicy = JSON.stringify(policy);

/**
 * Salted, so the commitment cannot be brute-forced back to the policy.
 *
 * An unsalted keccak over this JSON would be trivially reversible: the
 * allowlist is short, the bid ceiling is a round number, and every address is
 * already public. The salt is what makes publishing the commitment safe.
 */
const policyCommitment = keccak256(
  abi.encode(["bytes32", "bytes32"], [keccak256(toUtf8Bytes(rawPolicy)), policy.commitmentSalt]),
);

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
  salt: policy.contextSalt,
};

const contextCommitment = hashSanitizedContext(context);

function fixture(amount: string, nonce: string) {
  const ticket: PlacementTicketV2 = {
    schemaVersion: 2,
    ticketNonce: `0x${"11".repeat(32)}`,
    campaignId: policy.campaignId,
    campaignRevisionHash: policy.campaignRevisionHash,
    publisher: policy.publisher,
    contextCommitment,
    productRefHash: policy.allowedProductRefHashes[0],
    contentHash: `0x${"bb".repeat(32)}`,
    policyCommitment,
    policyProofLevel: 1,
    asset: policy.asset,
    amount,
    validUntil: "1800000000",
    chainId: String(protocol.chainId),
    settlementContract: protocol.settlement,
  };

  const subject = subjectFromTicket(ticket);
  const subjectHash = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES as never, subject);
  const quote = {
    schemaVersion: 1,
    campaignId: ticket.campaignId,
    subjectHash,
    payer: policy.payer,
    recipient: policy.recipient,
    asset: ticket.asset,
    amount: ticket.amount,
    // PlacementQuoteV1 predates the ticket and types this as a number.
    validUntil: Number(ticket.validUntil),
    nonce,
    chainId: protocol.chainId,
    settlementContract: protocol.settlement,
  };
  const quoteId = TypedDataEncoder.hash(domain(quote.chainId), QUOTE_TYPES as never, quote);

  // Field order here matches the existing config files so the diff stays
  // readable; the workflow parses by name, not position.
  return {
    schedule: "0 */1 * * * *",
    schemaVersion: 1,
    quoteId,
    campaignId: ticket.campaignId,
    subjectHash,
    payer: quote.payer,
    recipient: quote.recipient,
    asset: quote.asset,
    amount: quote.amount,
    chainId: String(protocol.chainId),
    settlementContract: protocol.settlement,
    validUntil: ticket.validUntil,
    nonce,
    policySecretId: "CAMPAIGN_POLICY",
    subject,
    ticket,
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
  };
}

const here = (...parts: string[]) => resolve(__dirname, "..", ...parts);
const write = (path: string, body: string) => {
  writeFileSync(here(path), body);
  console.log(`wrote ${path}`);
};

const eligible = fixture("1000000", `0x${"77".repeat(32)}`);
// One unit over the private ceiling, which the enclave alone knows.
const ineligible = fixture("1000001", `0x${"88".repeat(32)}`);

write("cre/placement-authorization/config.staging.json", `${JSON.stringify(eligible, null, 2)}\n`);
write(
  "cre/placement-authorization/config.ineligible.json",
  `${JSON.stringify(ineligible, null, 2)}\n`,
);
write(
  "cre/placement-authorization/simulation.env.example",
  [
    "# PUBLIC TEST FIXTURE ONLY. Never use these salts or this policy in production.",
    "# Regenerate with `npx hardhat run scripts/cre-placement-fixture.ts`.",
    `CRE_CAMPAIGN_POLICY_JSON='${rawPolicy}'`,
    "",
  ].join("\n"),
);

console.log(`  policyCommitment  ${policyCommitment}`);
console.log(`  contextCommitment ${contextCommitment}`);
console.log(`  eligible   ticket ${hashTicket(eligible.ticket)} quote ${eligible.quoteId}`);
console.log(`  ineligible ticket ${hashTicket(ineligible.ticket)} quote ${ineligible.quoteId}`);
