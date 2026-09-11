import {
  AbiCoder,
  concat,
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  recoverAddress,
} from "ethers";

/**
 * The authenticated consumption boundary for a live Chainlink CRE report.
 *
 * AdReceipt currently authorizes placements by running the CRE workflow through
 * the CLI simulator and reading its stdout. That proves the policy logic; it
 * proves nothing about *who* ran it. The simulator is not a TEE, its output is
 * not signed, and anything that can write to that pipe can claim an approval.
 * So the product reports `CRE_SIMULATED` and this module exists to be the only
 * path by which that can ever become `CRE_ENFORCED`.
 *
 * What has to be true before a decision counts as enforced:
 *
 *   1. The envelope is a real DON report - `f + 1` distinct signatures from the
 *      configured signer set over keccak256(keccak256(rawReport) ‖ reportContext).
 *   2. The report came from the workflow we deployed - owner, name, id and DON
 *      id all match the recorded deployment identity, not merely *a* CRE.
 *   3. The decision is about this exact placement - every one of the seventeen
 *      encoded fields is compared against the ticket and quote we hold.
 *   4. It is fresh and has not been seen before.
 *   5. It says eligible, and it says so at the enforced proof level.
 *
 * Any one of those failing yields `CRE_INVALID` or `CRE_UNAVAILABLE`, never a
 * decision. The distinction matters: collapsing "the provider is down" into
 * "declined" would make an outage look like a policy judgement, and collapsing
 * either into "approved" is the failure this whole module exists to prevent.
 *
 * The layout, the report hash and the quorum rule below are taken from the CRE
 * SDK's own report parser (`@chainlink/cre-sdk` `sdk/report.js`), not invented
 * here. This is the consumer half of a scheme whose producer half we cannot run
 * yet: see docs/evidence/chainlink.md for exactly what remains unverified.
 */

const abi = AbiCoder.defaultAbiCoder();

/**
 * The four states a placement authorization can be in.
 *
 * Kept explicit rather than collapsed into a boolean so that provider failure
 * can never be mistaken for a decision.
 */
export const PROOF_LEVELS = [
  /** Evaluated by the CRE CLI simulator. Correct logic, unauthenticated source. */
  "CRE_SIMULATED",
  /** Evaluated by the deployed workflow and delivered in an authenticated report. */
  "CRE_ENFORCED",
  /** No live path configured, or the provider could not be reached. */
  "CRE_UNAVAILABLE",
  /** A report arrived and failed authentication, binding, freshness or replay. */
  "CRE_INVALID",
] as const;

export type ProofLevel = (typeof PROOF_LEVELS)[number];

/** Matches POLICY_PROOF_LEVEL in cre/placement-authorization/ticket.ts. */
export const POLICY_PROOF_LEVEL = { CRE_SIMULATED: 1, CRE_ENFORCED: 2 } as const;

/** The report kind the placement-authorization workflow emits. */
export const REPORT_PLACEMENT_AUTHORIZATION = 1;

/** Byte offsets of the CRE report metadata header. From the CRE SDK. */
export const REPORT_METADATA_HEADER_LENGTH = 109;
const OFFSETS = {
  version: 0,
  executionId: 1,
  timestamp: 33,
  donId: 37,
  donConfigVersion: 41,
  workflowId: 45,
  workflowName: 77,
  workflowOwner: 87,
  reportId: 107,
  body: 109,
} as const;

/**
 * The exact ABI signature the workflow encodes.
 *
 * It must stay byte-identical to REPORT_PARAMS in
 * cre/placement-authorization/workflow.ts. A mismatch here does not fail
 * loudly - it decodes into plausible-looking wrong values - so a test asserts
 * the two strings are equal.
 */
export const REPORT_PARAMS = [
  "uint8 reportKind",
  "uint16 schemaVersion",
  "bytes32 ticketCommitment",
  "bytes32 quoteId",
  "bytes32 campaignId",
  "bytes32 campaignRevisionHash",
  "bytes32 subjectHash",
  "bytes32 contextCommitment",
  "address payer",
  "address recipient",
  "address asset",
  "uint256 amount",
  "uint256 chainId",
  "address settlementContract",
  "uint64 validUntil",
  "bytes32 nonce",
  "bool eligible",
  "uint8 policyProofLevel",
  "bytes32 policyCommitment",
].join(", ");

const REPORT_TYPES = REPORT_PARAMS.split(", ").map((param) => param.split(" ")[0]);

export interface ReportMetadataHeader {
  version: number;
  executionId: string;
  timestamp: number;
  donId: number;
  donConfigVersion: number;
  workflowId: string;
  workflowName: string;
  workflowOwner: string;
  reportId: string;
  body: string;
}

export interface ReportEnvelope {
  rawReport: string;
  reportContext: string;
  signatures: string[];
}

/**
 * The deployment we will accept reports from.
 *
 * Recorded once after deployment and then treated as an allowlist of exactly
 * one. Without it there is no such thing as a known-good report, which is why
 * an unconfigured identity produces `CRE_UNAVAILABLE` rather than a permissive
 * default.
 */
export interface WorkflowIdentity {
  workflowOwner: string;
  workflowName: string;
  workflowId: string;
  donId: number;
  /** Node signer addresses published by the capabilities registry. */
  signers: string[];
  /** Fault tolerance. A report needs `f + 1` distinct accepted signers. */
  f: number;
  maxAgeSeconds: number;
}

export interface AuthorizationBinding {
  schemaVersion: number;
  ticketCommitment: string;
  quoteId: string;
  campaignId: string;
  campaignRevisionHash: string;
  subjectHash: string;
  contextCommitment: string;
  policyCommitment: string;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  chainId: number;
  settlementContract: string;
  validUntil: number;
  nonce: string;
}

export interface DecodedAuthorization extends AuthorizationBinding {
  reportKind: number;
  eligible: boolean;
  policyProofLevel: number;
}

export type AuthorizationOutcome =
  | {
      proofLevel: "CRE_ENFORCED";
      decision: DecodedAuthorization;
      report: {
        executionId: string;
        reportId: string;
        workflowId: string;
        workflowName: string;
        workflowOwner: string;
        donId: number;
        timestamp: number;
        signers: string[];
      };
    }
  | { proofLevel: "CRE_INVALID" | "CRE_UNAVAILABLE"; reasonCode: string; reason: string };

/**
 * Reason codes are a closed set of fixed strings.
 *
 * They are returned to callers and written to logs, so they must never be
 * assembled from report contents, policy values or operator input - that is how
 * a private ceiling ends up in an error message.
 */
export const REASON = {
  NOT_CONFIGURED: ["CRE_UNAVAILABLE", "No deployed CRE workflow identity is configured."],
  MALFORMED_ENVELOPE: ["CRE_INVALID", "The report envelope is malformed."],
  REPORT_TOO_SHORT: ["CRE_INVALID", "The report is shorter than the CRE metadata header."],
  UNKNOWN_WORKFLOW: ["CRE_INVALID", "The report came from an unknown workflow or DON."],
  BAD_SIGNATURE: ["CRE_INVALID", "The report signatures did not reach the DON quorum."],
  UNDECODABLE_BODY: ["CRE_INVALID", "The report body is not a placement authorization."],
  WRONG_REPORT_KIND: ["CRE_INVALID", "The report is not a placement authorization."],
  BINDING_MISMATCH: ["CRE_INVALID", "The report is bound to different placement inputs."],
  STALE: ["CRE_INVALID", "The report is outside the accepted freshness window."],
  REPLAYED: ["CRE_INVALID", "This report has already been consumed."],
  NOT_ELIGIBLE: ["CRE_INVALID", "The confidential policy declined this placement."],
  NOT_ENFORCED_LEVEL: ["CRE_INVALID", "The report does not carry the enforced proof level."],
} as const satisfies Record<string, readonly ["CRE_INVALID" | "CRE_UNAVAILABLE", string]>;

function refuse(code: keyof typeof REASON): AuthorizationOutcome {
  const [proofLevel, reason] = REASON[code];
  return { proofLevel, reasonCode: code, reason };
}

function hex(value: string, bytes: number): boolean {
  return isHexString(value, bytes);
}

/** Parse the 109-byte header. Offsets and widths come from the CRE SDK. */
export function parseReportMetadataHeader(rawReport: string): ReportMetadataHeader {
  const raw = Buffer.from(rawReport.replace(/^0x/, ""), "hex");
  if (raw.length < REPORT_METADATA_HEADER_LENGTH) {
    throw new Error("REPORT_TOO_SHORT");
  }
  const slice = (start: number, length: number) =>
    `0x${raw.subarray(start, start + length).toString("hex")}`;
  return {
    version: raw[OFFSETS.version],
    executionId: slice(OFFSETS.executionId, 32),
    timestamp: raw.readUInt32BE(OFFSETS.timestamp),
    donId: raw.readUInt32BE(OFFSETS.donId),
    donConfigVersion: raw.readUInt32BE(OFFSETS.donConfigVersion),
    workflowId: slice(OFFSETS.workflowId, 32),
    // Ten bytes, padded. Trailing NULs are padding, not part of the name.
    workflowName: raw
      .subarray(OFFSETS.workflowName, OFFSETS.workflowName + 10)
      .toString("utf8")
      .replace(/\0+$/, ""),
    workflowOwner: slice(OFFSETS.workflowOwner, 20),
    reportId: slice(OFFSETS.reportId, 2),
    body: `0x${raw.subarray(OFFSETS.body).toString("hex")}`,
  };
}

/** keccak256(keccak256(rawReport) ‖ reportContext), as the CRE SDK computes it. */
export function computeReportHash(rawReport: string, reportContext: string): string {
  return keccak256(concat([keccak256(rawReport), reportContext]));
}

/**
 * Recover the distinct accepted signers of a report.
 *
 * Distinctness is the point: `f + 1` copies of one node's signature is one
 * node's opinion, not a quorum. Signatures from outside the configured set are
 * dropped rather than counted.
 */
export function recoverReportSigners(
  envelope: ReportEnvelope,
  identity: WorkflowIdentity,
): string[] {
  const digest = computeReportHash(envelope.rawReport, envelope.reportContext);
  const allowed = new Set(identity.signers.map((signer) => getAddress(signer)));
  const accepted = new Set<string>();

  for (const signature of envelope.signatures) {
    if (!hex(signature, 65)) continue;
    // The DON emits v as 27/28 or 0/1 depending on the node. Normalise before
    // recovery rather than rejecting a valid signature over an encoding detail.
    const bytes = Buffer.from(signature.replace(/^0x/, ""), "hex");
    if (bytes[64] === 0 || bytes[64] === 1) bytes[64] += 27;
    let recovered: string;
    try {
      recovered = getAddress(recoverAddress(digest, `0x${bytes.toString("hex")}`));
    } catch {
      continue;
    }
    if (allowed.has(recovered)) accepted.add(recovered);
  }
  return [...accepted];
}

/** Decode the workflow's report body. Throws rather than returning partials. */
export function decodeAuthorizationBody(body: string): DecodedAuthorization {
  const decoded = abi.decode(REPORT_TYPES, body);
  return {
    reportKind: Number(decoded[0]),
    schemaVersion: Number(decoded[1]),
    ticketCommitment: String(decoded[2]).toLowerCase(),
    quoteId: String(decoded[3]).toLowerCase(),
    campaignId: String(decoded[4]).toLowerCase(),
    campaignRevisionHash: String(decoded[5]).toLowerCase(),
    subjectHash: String(decoded[6]).toLowerCase(),
    contextCommitment: String(decoded[7]).toLowerCase(),
    payer: getAddress(String(decoded[8])),
    recipient: getAddress(String(decoded[9])),
    asset: getAddress(String(decoded[10])),
    amount: BigInt(decoded[11]).toString(),
    chainId: Number(decoded[12]),
    settlementContract: getAddress(String(decoded[13])),
    validUntil: Number(decoded[14]),
    nonce: String(decoded[15]).toLowerCase(),
    eligible: Boolean(decoded[16]),
    policyProofLevel: Number(decoded[17]),
    policyCommitment: String(decoded[18]).toLowerCase(),
  };
}

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Compare every bound field.
 *
 * Deliberately exhaustive and deliberately not short-circuiting on "close
 * enough": a report that agrees on sixteen fields and differs on the recipient
 * is an instruction to pay the wrong person.
 */
export function bindingMatches(
  decoded: DecodedAuthorization,
  expected: AuthorizationBinding,
): boolean {
  return (
    decoded.schemaVersion === expected.schemaVersion &&
    sameHex(decoded.ticketCommitment, expected.ticketCommitment) &&
    sameHex(decoded.quoteId, expected.quoteId) &&
    sameHex(decoded.campaignId, expected.campaignId) &&
    sameHex(decoded.campaignRevisionHash, expected.campaignRevisionHash) &&
    sameHex(decoded.subjectHash, expected.subjectHash) &&
    sameHex(decoded.contextCommitment, expected.contextCommitment) &&
    sameHex(decoded.policyCommitment, expected.policyCommitment) &&
    sameHex(decoded.payer, expected.payer) &&
    sameHex(decoded.recipient, expected.recipient) &&
    sameHex(decoded.asset, expected.asset) &&
    BigInt(decoded.amount) === BigInt(expected.amount) &&
    decoded.chainId === expected.chainId &&
    sameHex(decoded.settlementContract, expected.settlementContract) &&
    decoded.validUntil === expected.validUntil &&
    sameHex(decoded.nonce, expected.nonce)
  );
}

export interface ConsumeArgs {
  envelope: ReportEnvelope;
  identity: WorkflowIdentity | null;
  expected: AuthorizationBinding;
  now: number;
  /** Returns true if this executionId has already been consumed. */
  seen(executionId: string): boolean | Promise<boolean>;
}

/**
 * The whole boundary, in the order that fails cheapest first.
 *
 * Ordering is not cosmetic. Authentication runs before decoding so an
 * unauthenticated payload is never parsed as a decision, and the replay check
 * runs last so a report is only marked consumed once it would otherwise have
 * been accepted.
 */
export async function consumeAuthorizationReport(args: ConsumeArgs): Promise<AuthorizationOutcome> {
  const { envelope, identity, expected, now } = args;

  if (!identity) return refuse("NOT_CONFIGURED");

  if (
    !envelope ||
    typeof envelope.rawReport !== "string" ||
    !isHexString(envelope.rawReport) ||
    typeof envelope.reportContext !== "string" ||
    !isHexString(envelope.reportContext) ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length === 0
  ) {
    return refuse("MALFORMED_ENVELOPE");
  }

  let header: ReportMetadataHeader;
  try {
    header = parseReportMetadataHeader(envelope.rawReport);
  } catch {
    return refuse("REPORT_TOO_SHORT");
  }

  // Identity before signatures: a correctly signed report from somebody else's
  // workflow is still not ours.
  if (
    !sameHex(header.workflowOwner, identity.workflowOwner) ||
    header.workflowName !== identity.workflowName ||
    !sameHex(header.workflowId, identity.workflowId) ||
    header.donId !== identity.donId
  ) {
    return refuse("UNKNOWN_WORKFLOW");
  }

  const signers = recoverReportSigners(envelope, identity);
  if (signers.length < identity.f + 1) return refuse("BAD_SIGNATURE");

  let decoded: DecodedAuthorization;
  try {
    decoded = decodeAuthorizationBody(header.body);
  } catch {
    return refuse("UNDECODABLE_BODY");
  }
  if (decoded.reportKind !== REPORT_PLACEMENT_AUTHORIZATION) return refuse("WRONG_REPORT_KIND");
  if (!bindingMatches(decoded, expected)) return refuse("BINDING_MISMATCH");

  // Two clocks matter: when the DON produced the report, and when the quote
  // stops being valid. A fresh report about an expired quote is still useless.
  const age = now - header.timestamp;
  if (age > identity.maxAgeSeconds || age < -60) return refuse("STALE");
  if (decoded.validUntil <= now) return refuse("STALE");

  if (!decoded.eligible) return refuse("NOT_ELIGIBLE");
  if (decoded.policyProofLevel !== POLICY_PROOF_LEVEL.CRE_ENFORCED) {
    return refuse("NOT_ENFORCED_LEVEL");
  }

  if (await args.seen(header.executionId)) return refuse("REPLAYED");

  return {
    proofLevel: "CRE_ENFORCED",
    decision: decoded,
    report: {
      executionId: header.executionId,
      reportId: header.reportId,
      workflowId: header.workflowId,
      workflowName: header.workflowName,
      workflowOwner: header.workflowOwner,
      donId: header.donId,
      timestamp: header.timestamp,
      signers,
    },
  };
}

/**
 * Read the deployed workflow identity from the environment.
 *
 * Returns null unless every field is present and well formed. There is no
 * partial configuration: a half-configured identity would authenticate against
 * an incomplete allowlist, which is worse than having none.
 */
export function liveWorkflowIdentity(
  env: NodeJS.ProcessEnv = process.env,
): WorkflowIdentity | null {
  const owner = env.CRE_WORKFLOW_OWNER ?? "";
  const name = env.CRE_WORKFLOW_NAME ?? "";
  const workflowId = env.CRE_WORKFLOW_ID ?? "";
  const donId = Number(env.CRE_DON_ID);
  // `Number("")` is 0, and 0 is a legitimate fault tolerance for a single-node
  // DON - so an absent setting would silently drop the quorum to one signature.
  // Require the digits to actually be there.
  const rawF = (env.CRE_DON_F ?? "").trim();
  const f = Number(rawF);
  const signers = (env.CRE_DON_SIGNERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!isAddress(owner) || !hex(workflowId, 32)) return null;
  if (!name || name.length > 10) return null;
  if (!Number.isSafeInteger(donId) || donId <= 0) return null;
  if (!/^\d+$/.test(rawF) || !Number.isSafeInteger(f)) return null;
  if (signers.length === 0 || !signers.every((signer) => isAddress(signer))) return null;
  if (signers.length < f + 1) return null;

  const maxAge = Number(env.CRE_REPORT_MAX_AGE_SECONDS ?? 300);
  return {
    workflowOwner: getAddress(owner),
    workflowName: name,
    workflowId: workflowId.toLowerCase(),
    donId,
    f,
    signers: signers.map((signer) => getAddress(signer)),
    maxAgeSeconds: Number.isSafeInteger(maxAge) && maxAge > 0 ? maxAge : 300,
  };
}

/**
 * The binding a report must match, derived only from what we already hold.
 *
 * This exists as its own function so it can be tested in isolation, because the
 * failure it guards against is silent: if any field were read from the request
 * body instead, a report would get to choose what it is compared against and
 * every binding check below would pass trivially.
 */
export function expectedBindingFor(placement: {
  placementId: string;
  receiptId: string;
  ticket: { campaignRevisionHash: string; contextCommitment: string; policyCommitment: string };
  quote: {
    schemaVersion: number;
    campaignId: string;
    subjectHash: string;
    payer: string;
    recipient: string;
    asset: string;
    amount: string;
    chainId: number;
    settlementContract: string;
    validUntil: number;
    nonce: string;
  };
}): AuthorizationBinding {
  return {
    schemaVersion: placement.quote.schemaVersion,
    // The ticket commitment *is* the placement id, and the quote digest is the
    // receipt id. Recomputing them here would only add a way to disagree.
    ticketCommitment: placement.placementId,
    quoteId: placement.receiptId,
    campaignId: placement.quote.campaignId,
    campaignRevisionHash: placement.ticket.campaignRevisionHash,
    subjectHash: placement.quote.subjectHash,
    contextCommitment: placement.ticket.contextCommitment,
    policyCommitment: placement.ticket.policyCommitment,
    payer: placement.quote.payer,
    recipient: placement.quote.recipient,
    asset: placement.quote.asset,
    amount: placement.quote.amount,
    chainId: placement.quote.chainId,
    settlementContract: placement.quote.settlementContract,
    validUntil: placement.quote.validUntil,
    nonce: placement.quote.nonce,
  };
}

/**
 * Whether a proof level may be shown or settled against.
 *
 * One place, so the answer cannot drift between the API, the UI and the MCP
 * capability response. `CRE_UNAVAILABLE` and `CRE_INVALID` are both refusals.
 */
export function isAuthorizedProofLevel(level: ProofLevel): boolean {
  return level === "CRE_SIMULATED" || level === "CRE_ENFORCED";
}
