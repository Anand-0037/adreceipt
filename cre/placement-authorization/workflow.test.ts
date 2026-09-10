import { describe, expect } from "bun:test";
import { hexToBase64, type TeeRuntime } from "@chainlink/cre-sdk";
import { test } from "@chainlink/cre-sdk/test";
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from "viem";
import vectors from "../../shared/vectors/placement-ticket-v2.json";
import { configSchema, initWorkflow, onCronTrigger, type Config } from "./workflow";
import { hashQuote, hashSubject } from "./quote";
import {
  POLICY_PROOF_LEVEL,
  hashSanitizedContext,
  hashTicket,
  type PlacementTicket,
  type SanitizedContext,
} from "./ticket";

const REPORT_PARAMS =
  "uint8 reportKind, uint16 schemaVersion, bytes32 ticketCommitment, bytes32 quoteId, bytes32 campaignId, bytes32 campaignRevisionHash, bytes32 subjectHash, bytes32 contextCommitment, address payer, address recipient, address asset, uint256 amount, uint256 chainId, address settlementContract, uint64 validUntil, bytes32 nonce, bool eligible, uint8 policyProofLevel, bytes32 policyCommitment";

/** Key order is part of the policy commitment, as in the generated fixture. */
const basePolicy = {
  allowedProductRefHashes: [`0x${"44".repeat(32)}`],
  maxBid: "1000000",
  campaignId: `0x${"22".repeat(32)}`,
  campaignRevisionHash: `0x${"33".repeat(32)}`,
  allowedTopics: ["DATASETS", "DEVELOPER_TOOLS", "MACHINE_LEARNING"],
  allowedIntents: ["COMPARE_OPTIONS", "SOLVE_PROBLEM"],
  publisher: `0x${"99".repeat(20)}`,
  payer: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
  recipient: `0x${"55".repeat(20)}`,
  asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  chainId: "11155111",
  settlementContract: "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576",
  commitmentSalt: `0x${"cc".repeat(32)}`,
  contextSalt: `0x${"dd".repeat(32)}`,
};

const baseContext: SanitizedContext = {
  schemaVersion: 2,
  topics: ["DATASETS", "DEVELOPER_TOOLS", "MACHINE_LEARNING"],
  intent: "COMPARE_OPTIONS",
  commercialIntentBand: "HIGH",
  coarseLocale: "en-US",
  surface: "CHAT_ANSWER",
  ageEligibility: "ADULT_DECLARED",
  sensitiveClass: "NONE",
  personalization: false,
};

const saltedPolicyCommitment = (rawPolicy: string, salt: string) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32 policyHash, bytes32 salt"), [
      keccak256(stringToHex(rawPolicy)),
      salt as `0x${string}`,
    ]),
  );

/**
 * One coherent scenario: policy, ticket, subject and quote that all bind.
 *
 * The ticket commits to the policy commitment, and the policy commitment is a
 * hash over the policy JSON - so changing any policy field moves the ticket
 * commitment, the subject hash and the quote digest with it. Rebuilding the
 * whole chain per scenario is what keeps each test about the thing it names:
 * without it, lowering `maxBid` would fail the policy binding first and the bid
 * ceiling would never actually be exercised.
 *
 * `context` overrides only what the config carries, leaving the ticket
 * committed to `baseContext` - that is how a context-binding failure is staged.
 */
function scenario(
  overrides: {
    policy?: Record<string, unknown>;
    ticket?: Partial<PlacementTicket>;
    context?: SanitizedContext;
    bindContext?: boolean;
    config?: Record<string, unknown>;
  } = {},
) {
  const policy = { ...basePolicy, ...overrides.policy };
  const rawPolicy = JSON.stringify(policy);
  const policyCommitment = saltedPolicyCommitment(rawPolicy, policy.commitmentSalt);
  const configuredContext = overrides.context ?? baseContext;
  const committedContext = overrides.bindContext ? configuredContext : baseContext;
  const contextCommitment = hashSanitizedContext(committedContext, policy.contextSalt);

  const ticket: PlacementTicket = {
    schemaVersion: 2,
    ticketNonce: `0x${"11".repeat(32)}`,
    campaignId: policy.campaignId,
    campaignRevisionHash: policy.campaignRevisionHash,
    publisher: policy.publisher,
    contextCommitment,
    productRefHash: policy.allowedProductRefHashes[0],
    contentHash: `0x${"bb".repeat(32)}`,
    policyCommitment,
    policyProofLevel: POLICY_PROOF_LEVEL.CRE_SIMULATED,
    asset: policy.asset,
    amount: "1000000",
    validUntil: "1800000000",
    chainId: policy.chainId,
    settlementContract: policy.settlementContract,
    ...overrides.ticket,
  };

  const subject = {
    publisher: ticket.publisher,
    placementId: hashTicket(ticket),
    productRefHash: ticket.productRefHash,
    contentHash: ticket.contentHash,
    disclosureVersion: 2 as const,
  };

  const partial = {
    schedule: "0 */1 * * * *",
    schemaVersion: 1 as const,
    quoteId: `0x${"00".repeat(32)}`,
    campaignId: ticket.campaignId,
    subjectHash: hashSubject(subject),
    subject,
    payer: policy.payer,
    recipient: policy.recipient,
    asset: ticket.asset,
    amount: ticket.amount,
    chainId: policy.chainId,
    settlementContract: policy.settlementContract,
    validUntil: ticket.validUntil,
    nonce: `0x${"77".repeat(32)}`,
    policySecretId: "CAMPAIGN_POLICY",
    ticket,
    context: configuredContext,
  };
  const config = {
    ...partial,
    quoteId: hashQuote(partial as unknown as Config),
    ...overrides.config,
  } as unknown as Config;

  return { config, rawPolicy, policyCommitment, ticketCommitment: subject.placementId };
}

const makeRuntime = (rawPolicy: string, input: Config, now = 1799999999) => {
  const reports: { encodedPayload?: string }[] = [];
  const logs: string[] = [];
  const requestedSecrets: string[] = [];
  const runtime = {
    config: input,
    now: () => new Date(now * 1000),
    getSecret: ({ id }: { id?: string }) => {
      requestedSecrets.push(id ?? "");
      return { result: () => ({ id, value: rawPolicy }) };
    },
    log: (message: string) => logs.push(message),
    usingTheDons: () => ({
      report: (payload: { encodedPayload?: string }) => {
        reports.push(payload);
        return { result: () => ({}) };
      },
    }),
  };
  return { runtime: runtime as unknown as TeeRuntime<Config>, reports, logs, requestedSecrets };
};

const expectedReport = (
  config: Config,
  eligible: boolean,
  ticketCommitment: string,
  policyCommitment: string,
) =>
  hexToBase64(
    encodeAbiParameters(parseAbiParameters(REPORT_PARAMS), [
      1,
      config.schemaVersion,
      ticketCommitment as `0x${string}`,
      config.quoteId as `0x${string}`,
      config.campaignId as `0x${string}`,
      config.ticket.campaignRevisionHash as `0x${string}`,
      config.subjectHash as `0x${string}`,
      config.ticket.contextCommitment as `0x${string}`,
      config.payer as `0x${string}`,
      config.recipient as `0x${string}`,
      config.asset as `0x${string}`,
      BigInt(config.amount),
      BigInt(config.chainId),
      config.settlementContract as `0x${string}`,
      BigInt(config.validUntil),
      config.nonce as `0x${string}`,
      eligible,
      config.ticket.policyProofLevel,
      policyCommitment as `0x${string}`,
    ]),
  );

/** Run a scenario and assert the eligibility it reports. */
function decide(overrides: Parameters<typeof scenario>[0] = {}, now?: number) {
  const built = scenario(overrides);
  const { runtime, reports, logs } = makeRuntime(built.rawPolicy, built.config, now);
  const result = onCronTrigger(runtime);
  return { ...built, result, reports, logs };
}

describe("confidential placement authorization", () => {
  test("approves an eligible ticket at the private bid ceiling", () => {
    const { result, reports, config, ticketCommitment, policyCommitment } = decide();

    expect(result).toContain("eligible=true");
    expect(result).toContain(`ticketCommitment=${ticketCommitment}`);
    expect(reports).toHaveLength(1);
    expect(reports[0].encodedPayload).toBe(
      expectedReport(config, true, ticketCommitment, policyCommitment),
    );
  });

  test("requests only the campaign policy secret", () => {
    const built = scenario();
    const { runtime, requestedSecrets } = makeRuntime(built.rawPolicy, built.config);
    onCronTrigger(runtime);
    expect(requestedSecrets).toEqual(["CAMPAIGN_POLICY"]);
  });

  // The three ineligible paths the issue requires, plus the two new bindings
  // V2 introduces. Each reports a decision rather than throwing: a campaign
  // declining a placement is not a malformed input.
  test("declines a topic outside the private allowlist", () => {
    const { result } = decide({ policy: { allowedTopics: ["FINANCE"] } });
    expect(result).toContain("eligible=false");
  });

  test("allows extra context topics when the campaign targeting still clears the relevance floor", () => {
    const { result } = decide({
      policy: { allowedTopics: ["DEVELOPER_TOOLS", "MACHINE_LEARNING"] },
    });
    expect(result).toContain("eligible=true");
  });

  test("declines an intent outside the private allowlist", () => {
    const { result } = decide({ policy: { allowedIntents: ["PURCHASE_RESEARCH"] } });
    expect(result).toContain("eligible=false");
  });

  test("declines an amount above the private ceiling", () => {
    const { result } = decide({ policy: { maxBid: "999999" } });
    expect(result).toContain("eligible=false");
  });

  test("declines a ticket bound to a superseded campaign revision", () => {
    const { result } = decide({ ticket: { campaignRevisionHash: `0x${"ab".repeat(32)}` } });
    expect(result).toContain("eligible=false");
  });

  test("declines a product outside the private target allowlist", () => {
    // Move the ticket, not the policy: the scenario derives the ticket's
    // productRefHash from the allowlist, so narrowing the allowlist would drag
    // the ticket along with it and quietly test nothing.
    const { result } = decide({ ticket: { productRefHash: `0x${"88".repeat(32)}` } });
    expect(result).toContain("eligible=false");
  });

  test("declines a context the ticket did not commit to", () => {
    // The config claims one context while the ticket commits to another.
    // Only the enclave holds the salt, so only the enclave can catch this.
    const { result } = decide({ context: { ...baseContext, intent: "SOLVE_PROBLEM" } });
    expect(result).toContain("eligible=false");
  });

  test("declines a ticket bound to a different private policy", () => {
    const built = scenario();
    const otherCommitment = saltedPolicyCommitment(built.rawPolicy, `0x${"ee".repeat(32)}`);
    const mismatched = scenario({ ticket: { policyCommitment: otherCommitment } });
    const { runtime } = makeRuntime(mismatched.rawPolicy, mismatched.config);
    expect(onCronTrigger(runtime)).toContain("eligible=false");
  });

  test("declines when payer and recipient are the same wallet", () => {
    const { result } = decide({ policy: { recipient: basePolicy.payer } });
    expect(result).toContain("eligible=false");
  });

  test("declines expired quotes, including one second after expiry", () => {
    expect(decide({}, 1800000001).result).toContain("eligible=false");
  });

  test("allows the exact expiry second, matching Solidity", () => {
    expect(decide({}, 1800000000).result).toContain("eligible=true");
  });

  test("declines a ticket in a mental-health context even when the policy otherwise matches", () => {
    const { result } = decide({
      context: { ...baseContext, sensitiveClass: "MENTAL_HEALTH" },
      bindContext: true,
    });
    expect(result).toContain("eligible=false");
  });

  test("declines a ticket when adult eligibility is unknown", () => {
    const { result } = decide({
      context: { ...baseContext, ageEligibility: "UNKNOWN" },
      bindContext: true,
    });
    expect(result).toContain("eligible=false");
  });
});

describe("structural ticket binding", () => {
  // These are malformed inputs, so they throw and emit no report at all.
  test("rejects a placementId that is not the ticket commitment", () => {
    const built = scenario();
    const broken = {
      ...built.config,
      subject: { ...built.config.subject, placementId: `0x${"ab".repeat(32)}` },
    } as Config;
    const { runtime, reports } = makeRuntime(built.rawPolicy, broken);
    expect(() => onCronTrigger(runtime)).toThrow("Ticket binding mismatch");
    expect(reports).toHaveLength(0);
  });

  for (const field of ["productRefHash", "contentHash", "publisher"] as const) {
    test(`rejects a subject whose ${field} differs from the ticket`, () => {
      // placementId still verifies, because the ticket itself is untouched.
      // Without an explicit cross-check the subject could name one product
      // while its ticket committed to another.
      const built = scenario();
      const value = field === "publisher" ? `0x${"ab".repeat(20)}` : `0x${"ab".repeat(32)}`;
      const broken = {
        ...built.config,
        subject: { ...built.config.subject, [field]: value },
      } as Config;
      const { runtime, reports } = makeRuntime(built.rawPolicy, broken);
      expect(() => onCronTrigger(runtime)).toThrow();
      expect(reports).toHaveLength(0);
    });
  }

  for (const field of [
    "asset",
    "amount",
    "validUntil",
    "campaignId",
    "chainId",
    "settlementContract",
  ] as const) {
    test(`rejects a quote whose ${field} differs from the ticket`, () => {
      const built = scenario();
      const value =
        field === "asset" || field === "settlementContract"
          ? `0x${"ab".repeat(20)}`
          : field === "campaignId"
            ? `0x${"ab".repeat(32)}`
            : "1234567";
      const broken = { ...built.config, [field]: value } as Config;
      const { runtime, reports } = makeRuntime(built.rawPolicy, broken);
      expect(() => onCronTrigger(runtime)).toThrow();
      expect(reports).toHaveLength(0);
    });
  }

  test("refuses a ticket claiming CRE_ENFORCED", () => {
    // Nothing here can produce a live DON attestation. Removing this check is
    // the only way to emit that claim, which keeps it auditable.
    const built = scenario({ ticket: { policyProofLevel: POLICY_PROOF_LEVEL.CRE_ENFORCED } });
    const { runtime, reports } = makeRuntime(built.rawPolicy, built.config);
    expect(() => onCronTrigger(runtime)).toThrow("Unsupported policy proof level");
    expect(reports).toHaveLength(0);
  });

  for (const key of [
    "subjectHash",
    "quoteId",
    "nonce",
    "payer",
    "recipient",
    "chainId",
    "settlementContract",
  ] as const) {
    test(`rejects a changed ${key} with an unchanged digest`, () => {
      const built = scenario();
      const current = String(built.config[key]);
      const value =
        key === "chainId" ? "123" : current.replace(/.$/, current.endsWith("f") ? "e" : "f");
      const broken = { ...built.config, [key]: value } as Config;
      const { runtime, reports } = makeRuntime(built.rawPolicy, broken);
      expect(() => onCronTrigger(runtime)).toThrow();
      expect(reports).toHaveLength(0);
    });
  }
});

describe("confidentiality boundary", () => {
  test("does not leak private policy values into output", () => {
    const built = scenario({
      policy: { maxBid: "123456789", contextSalt: `0x${"fe".repeat(32)}` },
    });
    const { runtime, logs } = makeRuntime(built.rawPolicy, built.config);

    const result = onCronTrigger(runtime);

    expect(logs).toEqual([]);
    expect(result).not.toContain(built.rawPolicy);
    expect(result).not.toContain("123456789");
    expect(result).not.toContain("fe".repeat(32));
    expect(result).not.toContain("cc".repeat(32));
    expect(result).not.toContain("DEVELOPER_TOOLS");
  });

  test("keeps salts and allowlists out of the public report", () => {
    // A ceiling well above the amount, so finding it in the report cannot be
    // confused with finding the amount - which is public and, at the default
    // ceiling, encodes to the same 32 bytes.
    const ceiling = "777777777";
    const { reports, rawPolicy } = decide({ policy: { maxBid: ceiling } });
    const decoded = Buffer.from(reports[0].encodedPayload ?? "", "base64").toString("hex");

    for (const secret of [
      "cc".repeat(32),
      "dd".repeat(32),
      BigInt(ceiling).toString(16).padStart(64, "0"),
      // The allowed product, which the policy targets privately.
      "44".repeat(32),
    ]) {
      expect(decoded).not.toContain(secret);
    }
    // The commitment is present; the thing it commits to is not.
    expect(decoded).toContain(
      saltedPolicyCommitment(rawPolicy, basePolicy.commitmentSalt).slice(2),
    );
  });

  test("salting the policy commitment is what makes it publishable", () => {
    const built = scenario();
    // An unsalted commitment over this policy is reversible by anyone who can
    // guess the JSON, so the published value must not be that hash.
    expect(built.policyCommitment).not.toBe(keccak256(stringToHex(built.rawPolicy)));
  });

  test("sanitizes private JSON parse errors", () => {
    const built = scenario();
    const { runtime, reports } = makeRuntime("PRIVATE_UNDISCLOSED_POLICY", built.config);
    expect(() => onCronTrigger(runtime)).toThrow("Invalid campaign policy");
    expect(reports).toHaveLength(0);
  });

  test("sanitizes policy validation errors", () => {
    const built = scenario();
    const raw = JSON.stringify({ ...basePolicy, maxBid: "PRIVATE_INVALID_BID" });
    const { runtime } = makeRuntime(raw, built.config);
    try {
      onCronTrigger(runtime);
      throw new Error("Expected rejection");
    } catch (error) {
      expect((error as Error).message).toBe("Invalid campaign policy");
    }
  });

  for (const field of ["commitmentSalt", "contextSalt"] as const) {
    test(`requires a nonzero ${field}`, () => {
      const built = scenario();
      const raw = JSON.stringify({ ...basePolicy, [field]: `0x${"00".repeat(32)}` });
      const { runtime } = makeRuntime(raw, built.config);
      expect(() => onCronTrigger(runtime)).toThrow("Invalid campaign policy");
    });
  }
});

describe("cross-runtime hash vectors", () => {
  const vectorTicket = vectors.ticket as PlacementTicket;

  // The application computes these with ethers, this workflow with viem. The
  // committed vectors are the only thing forcing the two to agree.
  test("matches the committed PlacementTicketV2 vectors", () => {
    expect(hashSanitizedContext(vectors.context as SanitizedContext, vectors.contextSalt)).toBe(
      vectors.expected.contextCommitment as `0x${string}`,
    );
    expect(hashTicket(vectorTicket)).toBe(vectors.expected.ticketCommitment as `0x${string}`);
  });

  test("derives the same subject and receipt id from the vector ticket", () => {
    const ticket = vectorTicket;
    const subject = {
      publisher: ticket.publisher,
      placementId: hashTicket(ticket),
      productRefHash: ticket.productRefHash,
      contentHash: ticket.contentHash,
      disclosureVersion: 2 as const,
    };
    expect(hashSubject(subject)).toBe(vectors.expected.subjectHash as `0x${string}`);
    expect(
      hashQuote({ ...vectors.quote, chainId: String(vectors.quote.chainId) } as unknown as Config),
    ).toBe(vectors.expected.receiptId as `0x${string}`);
  });
});

describe("workflow configuration", () => {
  test("rejects an invalid settlement binding", () => {
    const { config } = scenario();
    expect(() => configSchema.parse({ ...config, settlementContract: "not-an-address" })).toThrow();
  });

  test("rejects a config with no ticket or context", () => {
    const { config } = scenario();
    const { ticket, context, ...withoutV2 } = config;
    expect(configSchema.safeParse(withoutV2).success).toBe(false);
  });

  test("rejects an unknown context vocabulary", () => {
    const { config } = scenario();
    for (const context of [
      { ...baseContext, topics: ["raw-query"] },
      { ...baseContext, intent: "anything" },
      { ...baseContext, surface: "banner" },
      { ...baseContext, coarseLocale: "english" },
      { ...baseContext, query: "what is the cheapest managed postgres" },
    ]) {
      expect(configSchema.safeParse({ ...config, context }).success).toBe(false);
    }
  });

  test("registers the authorization handler in a Nitro TEE", () => {
    const { config } = scenario();
    const handlers = initWorkflow(config);

    expect(handlers).toHaveLength(1);
    expect(handlers[0].fn).toBe(onCronTrigger);
    expect(handlers[0].requirements).toBeDefined();
  });

  for (const [key, value] of [
    ["amount", "0"],
    ["amount", "-1"],
    ["amount", "1.5"],
    ["amount", (1n << 256n).toString()],
    ["chainId", "0"],
    ["validUntil", (1n << 64n).toString()],
    ["schemaVersion", 2],
    ["recipient", `0x${"00".repeat(20)}`],
  ] as const) {
    test(`rejects invalid ${key}: ${value}`, () => {
      const { config } = scenario();
      expect(configSchema.safeParse({ ...config, [key]: value }).success).toBe(false);
    });
  }
});
