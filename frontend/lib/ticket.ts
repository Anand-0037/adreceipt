import { TypedDataEncoder, getAddress, isHexString } from "ethers";

/**
 * PlacementTicketV2 - the commitment a placement is bound to.
 *
 * V1 let a publisher sign a subject whose `placementId` was an opaque label
 * hash. Nothing tied that placement to the campaign revision it was sold
 * against, to the context it was shown in, or to the policy that authorised it,
 * so two of those three could change after signing without invalidating
 * anything.
 *
 * V2 folds all of them into one commitment and reuses `SubjectV1.placementId`
 * to carry it:
 *
 *   PlacementTicketV2 -> ticketCommitment -> SubjectV1.placementId
 *     -> SubjectV1.subjectHash -> PlacementQuoteV1.subjectHash
 *     -> EIP-712 quote digest (the receiptId)
 *
 * Because `placementId` is already a bytes32, this changes no contract ABI and
 * needs no redeployment: every V1 verifier keeps working, and anyone holding
 * the ticket can now additionally re-derive the placementId from it.
 *
 * This module is the application-side canonical encoding. The confidential
 * workflow carries a byte-identical mirror in
 * cre/placement-authorization/ticket.ts, written against viem instead of
 * ethers; shared/vectors/placement-ticket-v2.json pins both to the same
 * outputs so the two runtimes cannot drift apart silently.
 */

export const TICKET_SCHEMA_VERSION = 2;
export const CONTEXT_SCHEMA_VERSION = 2;

/**
 * How much the `policyProofLevel` claim is actually worth.
 *
 * The CRE CLI account is authenticated but deployment access is not enabled, so
 * nothing in this repository can honestly produce CRE_ENFORCED. The level is
 * part of the ticket precisely so a later enforced run commits to a different
 * ticketCommitment than a simulated one - upgrading the claim cannot be done
 * quietly.
 */
export const POLICY_PROOF_LEVEL = {
  /** Evaluated by the confidential handler in a local simulation. */
  CRE_SIMULATED: 0,
  /** Evaluated by a live DON with an authenticated Forwarder. Not reachable yet. */
  CRE_ENFORCED: 1,
} as const;

export type PolicyProofLevel = (typeof POLICY_PROOF_LEVEL)[keyof typeof POLICY_PROOF_LEVEL];

/**
 * The vocabularies a sanitized context may use.
 *
 * These are closed sets, not free text, and that is the whole point. A raw user
 * query is the most sensitive thing in the system; if the context fields
 * accepted arbitrary strings, the commitment would eventually be computed over
 * one - by accident or by a caller taking the shortest path. A fixed vocabulary
 * makes that structurally impossible rather than merely discouraged.
 */
export const CONTEXT_TOPICS = [
  "cloud-hosting",
  "developer-tools",
  "ecommerce",
  "education",
  "finance",
  "gaming",
  "health",
  "travel",
  "other",
] as const;

export const CONTEXT_INTENTS = [
  "compare",
  "learn",
  "purchase",
  "research",
  "troubleshoot",
  "other",
] as const;

export const CONTEXT_SURFACES = ["chat-answer", "search-result", "sidebar", "summary"] as const;

export type ContextTopic = (typeof CONTEXT_TOPICS)[number];
export type ContextIntent = (typeof CONTEXT_INTENTS)[number];
export type ContextSurface = (typeof CONTEXT_SURFACES)[number];

/** Language, or language and region. Bounded so it cannot smuggle a query. */
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export const SANITIZED_CONTEXT_V2_TYPES = {
  SanitizedContextV2: [
    { name: "schemaVersion", type: "uint16" },
    { name: "topic", type: "string" },
    { name: "intent", type: "string" },
    { name: "locale", type: "string" },
    { name: "surface", type: "string" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const PLACEMENT_TICKET_V2_TYPES = {
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
  ],
} as const;

export interface SanitizedContextV2 {
  schemaVersion: number;
  topic: ContextTopic;
  intent: ContextIntent;
  locale: string;
  surface: ContextSurface;
  /** Fresh per placement. Kept private; only its commitment is published. */
  salt: string;
}

export interface PlacementTicketV2 {
  schemaVersion: number;
  ticketNonce: string;
  campaignId: string;
  campaignRevisionHash: string;
  publisher: string;
  contextCommitment: string;
  productRefHash: string;
  contentHash: string;
  policyCommitment: string;
  policyProofLevel: PolicyProofLevel;
  asset: string;
  amount: string;
  /**
   * Seconds since the epoch, as a decimal string.
   *
   * A string, like `amount`, because the ticket is a wire format shared with the
   * confidential handler, which keeps every integer as a string so a uint256
   * cannot silently lose precision. Mixing the two representations meant the
   * same logical ticket serialised two ways and the runtimes disagreed.
   */
  validUntil: string;
}

function requireBytes32(value: unknown, field: string): string {
  if (typeof value !== "string" || !isHexString(value, 32)) {
    throw new Error(`${field} must be 32 bytes of hex.`);
  }
  return value.toLowerCase();
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be an address.`);
  let checksummed: string;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new Error(`${field} is not a valid address.`);
  }
  if (checksummed === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${field} must not be the zero address.`);
  }
  return checksummed;
}

function requireUint(value: unknown, bits: number, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a base-10 integer string.`);
  }
  const parsed = BigInt(value);
  if (parsed >= 1n << BigInt(bits)) throw new Error(`${field} exceeds uint${bits}.`);
  return parsed;
}

/**
 * Validate a sanitized context.
 *
 * Rejects rather than coerces. A context that fails here is a caller bug, and
 * silently normalising one would defeat the reason the vocabulary is closed.
 */
export function parseSanitizedContext(value: unknown): SanitizedContextV2 {
  if (typeof value !== "object" || value === null) throw new Error("Context must be an object.");
  const input = value as Record<string, unknown>;

  if (input.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    throw new Error(`Context schemaVersion must be ${CONTEXT_SCHEMA_VERSION}.`);
  }
  if (!CONTEXT_TOPICS.includes(input.topic as ContextTopic)) {
    throw new Error(`Unknown context topic. Allowed: ${CONTEXT_TOPICS.join(", ")}.`);
  }
  if (!CONTEXT_INTENTS.includes(input.intent as ContextIntent)) {
    throw new Error(`Unknown context intent. Allowed: ${CONTEXT_INTENTS.join(", ")}.`);
  }
  if (!CONTEXT_SURFACES.includes(input.surface as ContextSurface)) {
    throw new Error(`Unknown context surface. Allowed: ${CONTEXT_SURFACES.join(", ")}.`);
  }
  if (typeof input.locale !== "string" || !LOCALE_PATTERN.test(input.locale)) {
    throw new Error("Context locale must look like 'en' or 'en-US'.");
  }
  const salt = requireBytes32(input.salt, "Context salt");
  if (/^0x0{64}$/.test(salt)) throw new Error("Context salt must not be zero.");

  const known = new Set(["schemaVersion", "topic", "intent", "locale", "surface", "salt"]);
  for (const key of Object.keys(input)) {
    // An unexpected field is how a raw query would arrive. Refuse the whole
    // context rather than hash a subset of it and call that sanitized.
    if (!known.has(key)) throw new Error(`Unexpected context field: ${key}.`);
  }

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    topic: input.topic as ContextTopic,
    intent: input.intent as ContextIntent,
    locale: input.locale,
    surface: input.surface as ContextSurface,
    salt,
  };
}

/**
 * Commit to the sanitized context.
 *
 * The salt is what makes this worth publishing. Without it the commitment is a
 * hash over a handful of enumerated values and one locale - a few thousand
 * combinations, which anyone can enumerate offline to recover the context
 * exactly. With a fresh 32-byte salt the commitment reveals nothing until the
 * holder chooses to open it.
 */
export function hashSanitizedContext(context: SanitizedContextV2): string {
  const parsed = parseSanitizedContext(context);
  return TypedDataEncoder.hashStruct(
    "SanitizedContextV2",
    SANITIZED_CONTEXT_V2_TYPES as never,
    parsed,
  );
}

/** Validate a ticket. Every field is checked; nothing is defaulted. */
export function parseTicket(value: unknown): PlacementTicketV2 {
  if (typeof value !== "object" || value === null) throw new Error("Ticket must be an object.");
  const input = value as Record<string, unknown>;

  if (input.schemaVersion !== TICKET_SCHEMA_VERSION) {
    throw new Error(`Ticket schemaVersion must be ${TICKET_SCHEMA_VERSION}.`);
  }
  if (
    input.policyProofLevel !== POLICY_PROOF_LEVEL.CRE_SIMULATED &&
    input.policyProofLevel !== POLICY_PROOF_LEVEL.CRE_ENFORCED
  ) {
    throw new Error("policyProofLevel must be 0 (CRE_SIMULATED) or 1 (CRE_ENFORCED).");
  }

  const amount = requireUint(input.amount, 256, "Ticket amount");
  if (amount === 0n) throw new Error("Ticket amount must be greater than zero.");

  const validUntil = requireUint(input.validUntil, 64, "Ticket validUntil");
  if (validUntil === 0n) throw new Error("Ticket validUntil must be positive.");

  const known = new Set(Object.keys(EMPTY_TICKET_SHAPE));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new Error(`Unexpected ticket field: ${key}.`);
  }

  return {
    schemaVersion: TICKET_SCHEMA_VERSION,
    ticketNonce: requireBytes32(input.ticketNonce, "ticketNonce"),
    campaignId: requireBytes32(input.campaignId, "campaignId"),
    campaignRevisionHash: requireBytes32(input.campaignRevisionHash, "campaignRevisionHash"),
    publisher: requireAddress(input.publisher, "Ticket publisher"),
    contextCommitment: requireBytes32(input.contextCommitment, "contextCommitment"),
    productRefHash: requireBytes32(input.productRefHash, "productRefHash"),
    contentHash: requireBytes32(input.contentHash, "contentHash"),
    policyCommitment: requireBytes32(input.policyCommitment, "policyCommitment"),
    policyProofLevel: input.policyProofLevel,
    asset: requireAddress(input.asset, "Ticket asset"),
    amount: amount.toString(),
    validUntil: validUntil.toString(),
  };
}

/** Field names only; the values are never read. */
const EMPTY_TICKET_SHAPE: Record<keyof PlacementTicketV2, true> = {
  schemaVersion: true,
  ticketNonce: true,
  campaignId: true,
  campaignRevisionHash: true,
  publisher: true,
  contextCommitment: true,
  productRefHash: true,
  contentHash: true,
  policyCommitment: true,
  policyProofLevel: true,
  asset: true,
  amount: true,
  validUntil: true,
};

/**
 * The canonical ticket commitment.
 *
 * One encoding, EIP-712 hashStruct, so the type string itself is hashed in.
 * Renaming or reordering a field changes the commitment, which is the property
 * the whole binding rests on.
 */
export function hashTicket(ticket: PlacementTicketV2): string {
  const parsed = parseTicket(ticket);
  return TypedDataEncoder.hashStruct("PlacementTicketV2", PLACEMENT_TICKET_V2_TYPES as never, {
    ...parsed,
    amount: BigInt(parsed.amount),
    validUntil: BigInt(parsed.validUntil),
  });
}

/**
 * The SubjectV1 this ticket authorises.
 *
 * `placementId` is the ticket commitment, which is what carries V2 through the
 * unchanged V1 pipeline. `productRefHash` and `contentHash` are copied from the
 * ticket rather than passed in separately, so a subject cannot name one product
 * while its ticket committed to another.
 */
export function subjectFromTicket(ticket: PlacementTicketV2): {
  publisher: string;
  placementId: string;
  productRefHash: string;
  contentHash: string;
  disclosureVersion: number;
} {
  const parsed = parseTicket(ticket);
  return {
    publisher: parsed.publisher,
    placementId: hashTicket(parsed),
    productRefHash: parsed.productRefHash,
    contentHash: parsed.contentHash,
    disclosureVersion: 1,
  };
}
