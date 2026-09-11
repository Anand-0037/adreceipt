import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AbiCoder, Wallet, getAddress, keccak256 } from "ethers";
import {
  bindingMatches,
  expectedBindingFor,
  computeReportHash,
  consumeAuthorizationReport,
  decodeAuthorizationBody,
  isAuthorizedProofLevel,
  liveWorkflowIdentity,
  parseReportMetadataHeader,
  POLICY_PROOF_LEVEL,
  PROOF_LEVELS,
  recoverReportSigners,
  REPORT_METADATA_HEADER_LENGTH,
  REPORT_PARAMS,
  REPORT_PLACEMENT_AUTHORIZATION,
  type AuthorizationBinding,
  type AuthorizationOutcome,
  type ReportEnvelope,
  type WorkflowIdentity,
} from "./cre-report";

/**
 * These tests build genuine reports.
 *
 * The header is assembled byte by byte at the CRE SDK's offsets, the body is
 * really ABI-encoded, and the signatures are real ECDSA signatures over the
 * real digest from real keys. That matters: a verifier tested against its own
 * mocks proves only that it is self-consistent. Everything here would also have
 * to pass if the bytes arrived from a deployed DON.
 *
 * What these tests cannot prove is that a deployed DON produces exactly these
 * bytes, because deployment access is not enabled. See docs/evidence/chainlink.md.
 */

const abi = AbiCoder.defaultAbiCoder();

const NODES = [
  new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
  new Wallet("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"),
  new Wallet("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"),
];
const OUTSIDER = new Wallet("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

const IDENTITY: WorkflowIdentity = {
  workflowOwner: getAddress("0x84B5711b5Ff458478A2E55bb4797F5b254517a57"),
  workflowName: "placement",
  workflowId: `0x${"c1".repeat(32)}`,
  donId: 7,
  f: 1,
  signers: NODES.map((node) => node.address),
  maxAgeSeconds: 300,
};

const NOW = 1_800_000_000;

const BINDING: AuthorizationBinding = {
  schemaVersion: 1,
  ticketCommitment: `0x${"a1".repeat(32)}`,
  quoteId: `0x${"a2".repeat(32)}`,
  campaignId: `0x${"a3".repeat(32)}`,
  campaignRevisionHash: `0x${"a4".repeat(32)}`,
  subjectHash: `0x${"a5".repeat(32)}`,
  contextCommitment: `0x${"a6".repeat(32)}`,
  policyCommitment: `0x${"a7".repeat(32)}`,
  payer: getAddress("0x84B5711b5Ff458478A2E55bb4797F5b254517a57"),
  recipient: getAddress("0x5555555555555555555555555555555555555555"),
  asset: getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
  amount: "500000",
  chainId: 11155111,
  settlementContract: getAddress("0x2fB6889Cc142C622a0479aF56b75B98beAeD3576"),
  validUntil: NOW + 3600,
  nonce: `0x${"a8".repeat(32)}`,
};

function encodeBody(overrides: Partial<Record<string, unknown>> = {}): string {
  const v = {
    reportKind: REPORT_PLACEMENT_AUTHORIZATION,
    eligible: true,
    policyProofLevel: POLICY_PROOF_LEVEL.CRE_ENFORCED,
    ...BINDING,
    ...overrides,
  } as Record<string, unknown>;
  return abi.encode(
    REPORT_PARAMS.split(", ").map((p) => p.split(" ")[0]),
    [
      v.reportKind,
      v.schemaVersion,
      v.ticketCommitment,
      v.quoteId,
      v.campaignId,
      v.campaignRevisionHash,
      v.subjectHash,
      v.contextCommitment,
      v.payer,
      v.recipient,
      v.asset,
      v.amount,
      v.chainId,
      v.settlementContract,
      v.validUntil,
      v.nonce,
      v.eligible,
      v.policyProofLevel,
      v.policyCommitment,
    ],
  );
}

interface HeaderFields {
  version: number;
  executionId: string;
  timestamp: number;
  donId: number;
  donConfigVersion: number;
  workflowId: string;
  workflowName: string;
  workflowOwner: string;
  reportId: string;
}

/** Assemble a 109-byte metadata header at the CRE SDK's exact offsets. */
function encodeHeader(overrides: Partial<HeaderFields> = {}): Buffer {
  const o: HeaderFields = {
    version: 1,
    executionId: `0x${"e1".repeat(32)}`,
    timestamp: NOW - 10,
    donId: IDENTITY.donId,
    donConfigVersion: 3,
    workflowId: IDENTITY.workflowId,
    workflowName: IDENTITY.workflowName,
    workflowOwner: IDENTITY.workflowOwner,
    reportId: "0x0001",
    ...overrides,
  };
  const raw = Buffer.alloc(REPORT_METADATA_HEADER_LENGTH);
  raw[0] = o.version;
  Buffer.from(o.executionId.slice(2), "hex").copy(raw, 1);
  raw.writeUInt32BE(o.timestamp, 33);
  raw.writeUInt32BE(o.donId, 37);
  raw.writeUInt32BE(o.donConfigVersion, 41);
  Buffer.from(o.workflowId.slice(2), "hex").copy(raw, 45);
  Buffer.from(o.workflowName, "utf8").copy(raw, 77);
  Buffer.from(o.workflowOwner.slice(2), "hex").copy(raw, 87);
  Buffer.from(o.reportId.slice(2), "hex").copy(raw, 107);
  return raw;
}

/**
 * The refusal reason, or "ENFORCED".
 *
 * Flattening the union into one string keeps every assertion below a plain
 * equality check, instead of a narrowing dance that hides which branch ran.
 */
function reasonOf(outcome: AuthorizationOutcome): string {
  return outcome.proofLevel === "CRE_ENFORCED" ? "ENFORCED" : outcome.reasonCode;
}

function buildReport(
  options: {
    header?: Record<string, unknown>;
    body?: Record<string, unknown>;
    signers?: Wallet[];
    reportContext?: string;
    tamperAfterSigning?: boolean;
  } = {},
): ReportEnvelope {
  const header = encodeHeader(options.header);
  const body = Buffer.from(encodeBody(options.body).slice(2), "hex");
  let rawReport = `0x${Buffer.concat([header, body]).toString("hex")}`;
  const reportContext = options.reportContext ?? `0x${"cc".repeat(96)}`;
  const digest = computeReportHash(rawReport, reportContext);
  const signatures = (options.signers ?? [NODES[0], NODES[1]]).map(
    (node) => node.signingKey.sign(digest).serialized,
  );
  if (options.tamperAfterSigning) {
    // Flip one byte of the body after signing: the digest no longer matches.
    const bytes = Buffer.from(rawReport.slice(2), "hex");
    bytes[bytes.length - 1] ^= 0xff;
    rawReport = `0x${bytes.toString("hex")}`;
  }
  return { rawReport, reportContext, signatures };
}

const never = () => false;
const consume = (
  envelope: ReportEnvelope,
  over: Partial<Parameters<typeof consumeAuthorizationReport>[0]> = {},
) =>
  consumeAuthorizationReport({
    envelope,
    identity: IDENTITY,
    expected: BINDING,
    now: NOW,
    seen: never,
    ...over,
  });

// ── the encoding must not drift from the workflow ──────────────────────────

test("the decoder's ABI signature is byte-identical to the workflow's", () => {
  // A mismatch does not fail loudly - it decodes into plausible wrong values.
  const workflow = readFileSync(
    resolve(__dirname, "../../../cre/placement-authorization/workflow.ts"),
    "utf8",
  );
  const match = workflow.match(/const REPORT_PARAMS\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(match, "could not find REPORT_PARAMS in the workflow");
  assert.equal(REPORT_PARAMS, match[1]);
});

test("the header parses at the CRE SDK's offsets", () => {
  const envelope = buildReport();
  const header = parseReportMetadataHeader(envelope.rawReport);

  assert.equal(header.version, 1);
  assert.equal(header.executionId, `0x${"e1".repeat(32)}`);
  assert.equal(header.timestamp, NOW - 10);
  assert.equal(header.donId, IDENTITY.donId);
  assert.equal(header.workflowId, IDENTITY.workflowId);
  // Ten bytes, NUL-padded: the padding must not become part of the name.
  assert.equal(header.workflowName, "placement");
  assert.equal(header.workflowOwner.toLowerCase(), IDENTITY.workflowOwner.toLowerCase());
  assert.equal(decodeAuthorizationBody(header.body).ticketCommitment, BINDING.ticketCommitment);
});

test("the report hash is keccak(keccak(rawReport) || reportContext)", () => {
  const envelope = buildReport();
  assert.equal(
    computeReportHash(envelope.rawReport, envelope.reportContext),
    keccak256(`${keccak256(envelope.rawReport)}${envelope.reportContext.slice(2)}`),
  );
});

// ── the accepting path ─────────────────────────────────────────────────────

test("a correctly signed, correctly bound report is enforced", async () => {
  const outcome = await consume(buildReport());

  assert.equal(outcome.proofLevel, "CRE_ENFORCED");
  if (outcome.proofLevel !== "CRE_ENFORCED") return;
  assert.equal(outcome.decision.eligible, true);
  assert.equal(outcome.decision.policyProofLevel, POLICY_PROOF_LEVEL.CRE_ENFORCED);
  assert.equal(outcome.report.workflowName, "placement");
  assert.equal(outcome.report.donId, 7);
  assert.equal(outcome.report.signers.length, 2);
});

test("signatures are counted only from distinct configured signers", () => {
  const envelope = buildReport({ signers: [NODES[0], NODES[1], NODES[2]] });
  assert.equal(recoverReportSigners(envelope, IDENTITY).length, 3);

  // The same node twice is one node's opinion, not a quorum.
  const doubled = buildReport({ signers: [NODES[0], NODES[0]] });
  assert.equal(recoverReportSigners(doubled, IDENTITY).length, 1);

  // A signature from outside the DON set is dropped, not counted.
  const outsider = buildReport({ signers: [NODES[0], OUTSIDER] });
  assert.equal(recoverReportSigners(outsider, IDENTITY).length, 1);
});

// ── refusals ───────────────────────────────────────────────────────────────

test("an unconfigured live path is unavailable, never a decision", async () => {
  const outcome = await consume(buildReport(), { identity: null });
  assert.equal(outcome.proofLevel, "CRE_UNAVAILABLE");
  assert.equal(reasonOf(outcome), "NOT_CONFIGURED");
});

test("a report from another workflow or DON is refused", async () => {
  for (const header of [
    { workflowOwner: getAddress("0x1111111111111111111111111111111111111111") },
    { workflowName: "otherflow" },
    { workflowId: `0x${"c2".repeat(32)}` },
    { donId: 8 },
  ]) {
    const outcome = await consume(buildReport({ header }));
    assert.equal(reasonOf(outcome), "UNKNOWN_WORKFLOW", JSON.stringify(header));
  }
});

test("a report below quorum, unsigned, or tampered with is refused", async () => {
  // f = 1, so one signature is one short of f + 1.
  const thin = await consume(buildReport({ signers: [NODES[0]] }));
  assert.equal(thin.proofLevel, "CRE_INVALID");
  assert.equal(reasonOf(thin), "BAD_SIGNATURE");

  const forged = await consume(buildReport({ signers: [OUTSIDER, NODES[0]] }));
  assert.equal(reasonOf(forged), "BAD_SIGNATURE");

  // Signed honestly, then a byte of the decision flipped in transit.
  const tampered = await consume(buildReport({ tamperAfterSigning: true }));
  assert.equal(reasonOf(tampered), "BAD_SIGNATURE");
});

test("every bound field is checked, not just the obvious ones", async () => {
  const mutations: [string, unknown][] = [
    ["ticketCommitment", `0x${"b1".repeat(32)}`],
    ["quoteId", `0x${"b2".repeat(32)}`],
    ["campaignId", `0x${"b3".repeat(32)}`],
    ["campaignRevisionHash", `0x${"b4".repeat(32)}`],
    ["subjectHash", `0x${"b5".repeat(32)}`],
    ["contextCommitment", `0x${"b6".repeat(32)}`],
    ["policyCommitment", `0x${"b7".repeat(32)}`],
    ["payer", getAddress("0x1111111111111111111111111111111111111111")],
    ["recipient", getAddress("0x2222222222222222222222222222222222222222")],
    ["asset", getAddress("0x3333333333333333333333333333333333333333")],
    ["amount", "500001"],
    ["chainId", 1],
    ["settlementContract", getAddress("0x4444444444444444444444444444444444444444")],
    ["validUntil", NOW + 7200],
    ["nonce", `0x${"b8".repeat(32)}`],
    ["schemaVersion", 2],
  ];

  for (const [field, value] of mutations) {
    // Signed correctly: only the binding differs, so this is the case where a
    // lazy verifier would wave it through.
    const outcome = await consume(buildReport({ body: { [field]: value } }));
    assert.equal(reasonOf(outcome), "BINDING_MISMATCH", `${field} was not compared`);
  }
});

test("stale, future-dated and expired reports are refused", async () => {
  const old = await consume(buildReport({ header: { timestamp: NOW - 301 } }));
  assert.equal(reasonOf(old), "STALE");

  const future = await consume(buildReport({ header: { timestamp: NOW + 120 } }));
  assert.equal(reasonOf(future), "STALE");

  // A fresh report about a quote that has already lapsed is still useless.
  const expiredQuote = await consumeAuthorizationReport({
    envelope: buildReport({ body: { validUntil: NOW - 1 } }),
    identity: IDENTITY,
    expected: { ...BINDING, validUntil: NOW - 1 },
    now: NOW,
    seen: never,
  });
  assert.equal(reasonOf(expiredQuote), "STALE");
});

test("a replayed report is refused", async () => {
  const envelope = buildReport();
  const first = await consume(envelope);
  assert.equal(first.proofLevel, "CRE_ENFORCED");

  const consumed = new Set<string>();
  if (first.proofLevel === "CRE_ENFORCED") consumed.add(first.report.executionId);

  const second = await consume(envelope, { seen: (id) => consumed.has(id) });
  assert.equal(second.proofLevel, "CRE_INVALID");
  assert.equal(reasonOf(second), "REPLAYED");
});

test("an ineligible decision is a refusal, not an approval", async () => {
  const outcome = await consume(buildReport({ body: { eligible: false } }));
  assert.equal(outcome.proofLevel, "CRE_INVALID");
  assert.equal(reasonOf(outcome), "NOT_ELIGIBLE");
});

test("a simulated proof level can never yield an enforced outcome", async () => {
  // This is what stops a deployed-looking report from upgrading the claim while
  // the workflow is still emitting the simulated level.
  const outcome = await consume(
    buildReport({ body: { policyProofLevel: POLICY_PROOF_LEVEL.CRE_SIMULATED } }),
  );
  assert.equal(outcome.proofLevel, "CRE_INVALID");
  assert.equal(reasonOf(outcome), "NOT_ENFORCED_LEVEL");
});

test("malformed envelopes and bodies are refused before decoding", async () => {
  const cases: [ReportEnvelope, string][] = [
    [{ rawReport: "not-hex", reportContext: "0x00", signatures: ["0x00"] }, "MALFORMED_ENVELOPE"],
    [{ rawReport: "0x00", reportContext: "0x00", signatures: [] }, "MALFORMED_ENVELOPE"],
    [
      {
        rawReport: `0x${"00".repeat(50)}`,
        reportContext: `0x${"cc".repeat(96)}`,
        signatures: [`0x${"11".repeat(65)}`],
      },
      "REPORT_TOO_SHORT",
    ],
  ];
  for (const [envelope, expected] of cases) {
    const outcome = await consume(envelope);
    if (outcome.proofLevel === "CRE_ENFORCED") assert.fail(`${expected} was accepted`);
    assert.equal(outcome.reasonCode, expected);
  }

  // A well-formed header wrapping a body that is not an authorization.
  const header = encodeHeader();
  const junk = Buffer.from(`0x${"7f".repeat(64)}`.slice(2), "hex");
  const rawReport = `0x${Buffer.concat([header, junk]).toString("hex")}`;
  const reportContext = `0x${"cc".repeat(96)}`;
  const digest = computeReportHash(rawReport, reportContext);
  const undecodable = await consume({
    rawReport,
    reportContext,
    signatures: [NODES[0], NODES[1]].map((n) => n.signingKey.sign(digest).serialized),
  });
  if (undecodable.proofLevel === "CRE_ENFORCED") assert.fail("junk body was accepted");
  assert.ok(["UNDECODABLE_BODY", "WRONG_REPORT_KIND"].includes(undecodable.reasonCode));
});

test("a report of another kind is refused", async () => {
  const outcome = await consume(buildReport({ body: { reportKind: 2 } }));
  assert.equal(reasonOf(outcome), "WRONG_REPORT_KIND");
});

// ── configuration and disclosure ───────────────────────────────────────────

test("a partially configured identity is no identity at all", () => {
  const complete = {
    CRE_WORKFLOW_OWNER: IDENTITY.workflowOwner,
    CRE_WORKFLOW_NAME: "placement",
    CRE_WORKFLOW_ID: IDENTITY.workflowId,
    CRE_DON_ID: "7",
    CRE_DON_F: "1",
    CRE_DON_SIGNERS: NODES.map((n) => n.address).join(","),
  };
  assert.ok(liveWorkflowIdentity(complete as NodeJS.ProcessEnv));

  for (const key of Object.keys(complete)) {
    const partial = { ...complete, [key]: "" };
    assert.equal(liveWorkflowIdentity(partial as NodeJS.ProcessEnv), null, `${key} was optional`);
  }
  // Fewer signers than the quorum needs can never reach f + 1.
  assert.equal(
    liveWorkflowIdentity({
      ...complete,
      CRE_DON_SIGNERS: NODES[0].address,
      CRE_DON_F: "2",
    } as NodeJS.ProcessEnv),
    null,
  );
  // A name longer than the header's ten bytes could never round-trip.
  assert.equal(
    liveWorkflowIdentity({
      ...complete,
      CRE_WORKFLOW_NAME: "far-too-long-name",
    } as NodeJS.ProcessEnv),
    null,
  );
});

test("only simulated and enforced levels may be shown or settled", () => {
  assert.deepEqual(PROOF_LEVELS.filter(isAuthorizedProofLevel), ["CRE_SIMULATED", "CRE_ENFORCED"]);
  assert.equal(isAuthorizedProofLevel("CRE_UNAVAILABLE"), false);
  assert.equal(isAuthorizedProofLevel("CRE_INVALID"), false);
});

test("no refusal discloses policy values, salts or report contents", async () => {
  const SECRET_CEILING = "999999999";
  const SECRET_SALT = `0x${"5e".repeat(32)}`;
  const outcomes = await Promise.all([
    consume(buildReport({ body: { eligible: false } })),
    consume(buildReport({ body: { amount: SECRET_CEILING } })),
    consume(buildReport({ body: { policyCommitment: SECRET_SALT } })),
    consume(buildReport({ signers: [OUTSIDER] })),
    consume(buildReport({ header: { workflowName: "otherflow" } })),
  ]);

  const text = JSON.stringify(outcomes);
  assert.equal(text.includes(SECRET_CEILING), false);
  assert.equal(text.includes(SECRET_SALT.slice(2)), false);
  assert.equal(text.includes("otherflow"), false);
  for (const outcome of outcomes) {
    assert.notEqual(outcome.proofLevel, "CRE_ENFORCED");
  }
});

test("bindingMatches is exhaustive over the binding type", () => {
  // Guards against a field being added to AuthorizationBinding and silently
  // left out of the comparison.
  const decoded = decodeAuthorizationBody(parseReportMetadataHeader(buildReport().rawReport).body);
  assert.equal(bindingMatches(decoded, BINDING), true);
  for (const key of Object.keys(BINDING) as (keyof AuthorizationBinding)[]) {
    const value = BINDING[key];
    const changed =
      typeof value === "number"
        ? value + 1
        : /^0x[0-9a-f]{40}$/i.test(String(value))
          ? getAddress("0x9999999999999999999999999999999999999999")
          : /^0x/.test(String(value))
            ? `0x${"f0".repeat(32)}`
            : String(BigInt(String(value)) + 1n);
    assert.equal(
      bindingMatches(decoded, { ...BINDING, [key]: changed }),
      false,
      `${key} is not compared`,
    );
  }
});

// ── the binding must come from stored state, not the request ───────────────

test("the expected binding is derived only from the stored placement", () => {
  // The failure this guards against is silent: a report that supplies any part
  // of what it is compared against passes every binding check trivially.
  const placement = {
    placementId: BINDING.ticketCommitment,
    receiptId: BINDING.quoteId,
    ticket: {
      campaignRevisionHash: BINDING.campaignRevisionHash,
      contextCommitment: BINDING.contextCommitment,
      policyCommitment: BINDING.policyCommitment,
    },
    quote: {
      schemaVersion: BINDING.schemaVersion,
      campaignId: BINDING.campaignId,
      subjectHash: BINDING.subjectHash,
      payer: BINDING.payer,
      recipient: BINDING.recipient,
      asset: BINDING.asset,
      amount: BINDING.amount,
      chainId: BINDING.chainId,
      settlementContract: BINDING.settlementContract,
      validUntil: BINDING.validUntil,
      nonce: BINDING.nonce,
    },
  };

  assert.deepEqual(expectedBindingFor(placement), BINDING);

  // The ticket commitment is the placement id and the quote digest is the
  // receipt id; nothing else may supply them.
  const moved = expectedBindingFor({
    ...placement,
    placementId: `0x${"f1".repeat(32)}`,
    receiptId: `0x${"f2".repeat(32)}`,
  });
  assert.equal(moved.ticketCommitment, `0x${"f1".repeat(32)}`);
  assert.equal(moved.quoteId, `0x${"f2".repeat(32)}`);
  assert.equal(
    bindingMatches(
      decodeAuthorizationBody(parseReportMetadataHeader(buildReport().rawReport).body),
      moved,
    ),
    false,
  );
});

test("a report for one placement cannot authorize another", async () => {
  // Smoke-test case 4: one changed ticket binding, refused before settlement.
  const other = { ...BINDING, ticketCommitment: `0x${"f1".repeat(32)}` };
  const outcome = await consume(buildReport(), { expected: other });
  assert.equal(reasonOf(outcome), "BINDING_MISMATCH");
});
