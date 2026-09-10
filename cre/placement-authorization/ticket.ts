import {
  encodeAbiParameters,
  hashStruct,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";
import { z } from "zod";

import { address, bytes32, uint } from "./quote";

/**
 * PlacementTicketV2, as the confidential handler sees it.
 *
 * This is a deliberate mirror of frontend/lib/ticket.ts, written against viem
 * because the workflow cannot pull in ethers. Two implementations of one
 * encoding is a drift risk, so it is not left to review:
 * shared/vectors/placement-ticket-v2.json pins both runtimes to the same
 * outputs, and both test suites assert against it. Change a type array here
 * without changing it there and the vectors fail on the next run.
 *
 * The handler needs its own copy because it must recompute the commitments
 * itself. Accepting a ticketCommitment supplied in the config would let a
 * caller hand the enclave one ticket and the chain another.
 */

export const TICKET_SCHEMA_VERSION = 2;
export const CONTEXT_SCHEMA_VERSION = 2;

export const POLICY_PROOF_LEVEL = {
  CRE_SIMULATED: 1,
  CRE_ENFORCED: 2,
} as const;

export const CONTEXT_TOPICS = [
  "CLOUD_INFRASTRUCTURE",
  "DATASETS",
  "DEVELOPER_TOOLS",
  "ECOMMERCE",
  "EDUCATION",
  "FINANCE",
  "MACHINE_LEARNING",
  "PRODUCTIVITY",
] as const;

export const CONTEXT_INTENTS = [
  "DISCOVER_TOOL",
  "COMPARE_OPTIONS",
  "SOLVE_PROBLEM",
  "PURCHASE_RESEARCH",
] as const;

export const CONTEXT_COMMERCIAL_INTENT_BANDS = ["UNCLASSIFIED", "LOW", "MEDIUM", "HIGH"] as const;
export const CONTEXT_SURFACES = ["CHAT_ANSWER", "SEARCH_RESULT", "SIDEBAR", "SUMMARY"] as const;
export const CONTEXT_AGE_ELIGIBILITY = ["ADULT_DECLARED", "UNDER_18", "UNKNOWN"] as const;
export const CONTEXT_SENSITIVE_CLASSES = [
  "NONE",
  "HEALTH",
  "MENTAL_HEALTH",
  "SELF_HARM",
  "POLITICS",
  "MINORS",
  "SEXUAL_CONTENT",
  "GAMBLING",
  "WEAPONS",
  "DRUGS_ALCOHOL",
  "DANGEROUS_ILLEGAL",
] as const;

export const sanitizedContextSchema = z
  .object({
    schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION),
    topics: z
      .array(z.enum(CONTEXT_TOPICS))
      .min(1)
      .max(CONTEXT_TOPICS.length)
      .refine((values) => new Set(values).size === values.length, "Duplicate topic")
      .refine(
        (values) => values.join("|") === [...values].sort().join("|"),
        "Topics must be sorted",
      ),
    intent: z.enum(CONTEXT_INTENTS),
    commercialIntentBand: z.enum(CONTEXT_COMMERCIAL_INTENT_BANDS),
    // Bounded on purpose. Free text here would eventually carry a raw query.
    coarseLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    surface: z.enum(CONTEXT_SURFACES),
    ageEligibility: z.enum(CONTEXT_AGE_ELIGIBILITY),
    sensitiveClass: z.enum(CONTEXT_SENSITIVE_CLASSES),
    personalization: z.literal(false),
  })
  .strict();

export type SanitizedContext = z.infer<typeof sanitizedContextSchema>;

export const ticketSchema = z
  .object({
    schemaVersion: z.literal(TICKET_SCHEMA_VERSION),
    ticketNonce: bytes32,
    campaignId: bytes32,
    campaignRevisionHash: bytes32,
    publisher: address,
    contextCommitment: bytes32,
    productRefHash: bytes32,
    contentHash: bytes32,
    policyCommitment: bytes32,
    policyProofLevel: z.union([
      z.literal(POLICY_PROOF_LEVEL.CRE_SIMULATED),
      z.literal(POLICY_PROOF_LEVEL.CRE_ENFORCED),
    ]),
    asset: address,
    amount: uint(256).refine((value) => BigInt(value) > 0n, "Must be positive"),
    validUntil: uint(64),
    chainId: uint(256).refine((value) => BigInt(value) > 0n, "Must be positive"),
    settlementContract: address,
  })
  .strict();

export type PlacementTicket = z.infer<typeof ticketSchema>;

export const sanitizedContextTypes = {
  SanitizedContextV2: [
    { name: "schemaVersion", type: "uint16" },
    { name: "topicsHash", type: "bytes32" },
    { name: "intentHash", type: "bytes32" },
    { name: "commercialIntentBand", type: "uint8" },
    { name: "coarseLocaleHash", type: "bytes32" },
    { name: "surfaceHash", type: "bytes32" },
    { name: "sensitiveClass", type: "uint8" },
    { name: "ageEligibility", type: "uint8" },
    { name: "personalization", type: "bool" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const ticketTypes = {
  PlacementTicketV2: [
    { name: "schemaVersion", type: "uint16" },
    { name: "ticketNonce", type: "bytes32" },
    { name: "campaignId", type: "bytes32" },
    { name: "campaignRevisionHash", type: "bytes32" },
    { name: "publisher", type: "address" },
    { name: "contextCommitment", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "policyCommitment", type: "bytes32" },
    { name: "policyProofLevel", type: "uint8" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "chainId", type: "uint256" },
    { name: "settlementContract", type: "address" },
  ],
} as const;

/**
 * Commit to the sanitized context under a private salt.
 *
 * The salt lives in the campaign policy secret, never in the workflow config,
 * so it stays inside the handler. Without it the commitment covers a few
 * thousand enumerated combinations and anyone could recover the context by
 * enumerating them offline.
 */
export function hashSanitizedContext(context: SanitizedContext, salt: string): Hex {
  const parsed = sanitizedContextSchema.parse(context);
  const topicsHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32[]"), [
      parsed.topics.map((topic) => keccak256(stringToHex(topic))),
    ]),
  );
  return hashStruct({
    primaryType: "SanitizedContextV2",
    types: sanitizedContextTypes,
    data: {
      schemaVersion: parsed.schemaVersion,
      topicsHash,
      intentHash: keccak256(stringToHex(parsed.intent)),
      commercialIntentBand: CONTEXT_COMMERCIAL_INTENT_BANDS.indexOf(parsed.commercialIntentBand),
      coarseLocaleHash: keccak256(stringToHex(parsed.coarseLocale)),
      surfaceHash: keccak256(stringToHex(parsed.surface)),
      sensitiveClass: CONTEXT_SENSITIVE_CLASSES.indexOf(parsed.sensitiveClass),
      ageEligibility: CONTEXT_AGE_ELIGIBILITY.indexOf(parsed.ageEligibility),
      personalization: parsed.personalization,
      salt: salt as Hex,
    },
  });
}

/** The canonical ticket commitment, which becomes SubjectV1.placementId. */
export function hashTicket(ticket: PlacementTicket): Hex {
  const parsed = ticketSchema.parse(ticket);
  return hashStruct({
    primaryType: "PlacementTicketV2",
    types: ticketTypes,
    data: {
      schemaVersion: parsed.schemaVersion,
      ticketNonce: parsed.ticketNonce as Hex,
      campaignId: parsed.campaignId as Hex,
      campaignRevisionHash: parsed.campaignRevisionHash as Hex,
      publisher: parsed.publisher as Hex,
      contextCommitment: parsed.contextCommitment as Hex,
      productRefHash: parsed.productRefHash as Hex,
      contentHash: parsed.contentHash as Hex,
      policyCommitment: parsed.policyCommitment as Hex,
      policyProofLevel: parsed.policyProofLevel,
      asset: parsed.asset as Hex,
      amount: BigInt(parsed.amount),
      validUntil: BigInt(parsed.validUntil),
      chainId: BigInt(parsed.chainId),
      settlementContract: parsed.settlementContract as Hex,
    },
  });
}
