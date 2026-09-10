export type AgeEligibility = "ADULT_DECLARED" | "UNDER_18" | "UNKNOWN";
export type DecisionStatus = "ELIGIBLE" | "SUPPRESSED" | "NO_MATCH";
export type PlacementStatus = "AUTHORIZED" | "SIGNED" | "PAID_VERIFIED" | "INVALID";
export type ReceiptStatus =
  | "PAID_VERIFIED"
  | "PENDING"
  | "NOT_FOUND_AT_BLOCK"
  | "INVALID"
  | "UNAVAILABLE";

export interface CampaignManifest {
  campaignId: string;
  revision: number;
  brandDisplayName: string;
  creativeHeadline: string;
  creativeBody: string;
  landingPage: string;
}

export interface ContextDecision {
  decisionId: string;
  status: DecisionStatus;
  reasonCode: string;
  context: {
    topics: string[];
    intent: string;
    coarseLocale: string;
    sensitiveClass: string;
    ageEligibility: AgeEligibility;
    personalization: false;
    contextCommitment: string;
  };
  winner?: {
    campaignId: string;
    revision: number;
    relevance: string;
    campaign: CampaignManifest;
  };
  rejected: Array<{ campaignId: string; reasonCode: string }>;
}

export interface Placement {
  placementId: string;
  decisionId: string;
  campaignId: string;
  receiptId: string;
  displayText: string;
  landingPage: string;
  status: PlacementStatus;
  subject: {
    publisher: string;
    placementId: string;
    productRefHash: string;
    contentHash: string;
    disclosureVersion: number;
  };
  quote: {
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
  };
  authorization: { proofLevel: "CRE_SIMULATED"; eligible: true };
}

export const PLACEMENT_QUOTE_TYPES = {
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

export function publisherQuoteTypedData(placement: Placement) {
  return {
    domain: {
      name: "AdReceipt" as const,
      version: "1" as const,
      chainId: placement.quote.chainId,
      verifyingContract: placement.quote.settlementContract,
    },
    primaryType: "PlacementQuoteV1" as const,
    types: PLACEMENT_QUOTE_TYPES,
    message: placement.quote,
  };
}

export interface VerificationResult {
  status: ReceiptStatus;
  reason: string;
}

export interface PlacementEvidence {
  placement: Placement;
  decision: ContextDecision;
  campaign: { manifest: CampaignManifest };
}

export interface PublisherResponse {
  organic: string;
  decision: ContextDecision;
  sponsorship: null;
  state: "ELIGIBLE_PAYMENT_REQUIRED" | "NO_MATCH" | "SUPPRESSED";
}

export interface PublisherUnavailableResponse {
  organic: string;
  decision: null;
  sponsorship: null;
  state: "UNAVAILABLE";
  reason: string;
}

export type PublisherRouterResponse = PublisherResponse | PublisherUnavailableResponse;

export interface VerifiedPublisherResponse {
  organic: string;
  state: "VERIFIED" | "WITHHELD";
  sponsorship: {
    label: "Sponsored · Verified";
    brand: string;
    headline: string;
    body: string;
    landingPage: string;
    receiptId: string;
    receiptUrl?: string;
    payment: { amount: string; asset: string; recipient: string };
    proof: {
      policy: "CRE_SIMULATED";
      payment: "PAID_VERIFIED";
      contextCommitment: string;
    };
  } | null;
  reason?: string;
}

export class AdReceiptApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdReceiptApiError";
  }
}

export interface AdReceiptClientOptions {
  apiBaseUrl: string;
  receiptBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidResponse(message: string): never {
  throw new Error(`Invalid AdReceipt API response: ${message}`);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== "string" || !result) invalidResponse(`${field} is missing`);
  return result;
}

function recordField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const result = value[field];
  if (!isRecord(result)) invalidResponse(`${field} is missing`);
  return result;
}

function positiveIntegerField(value: Record<string, unknown>, field: string): number {
  const result = value[field];
  if (!Number.isSafeInteger(result) || Number(result) < 1) {
    invalidResponse(`${field} is invalid`);
  }
  return Number(result);
}

function parseCampaign(value: unknown): CampaignManifest {
  if (!isRecord(value)) invalidResponse("campaign is missing");
  const revision = value.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
    invalidResponse("campaign revision is invalid");
  }
  return {
    campaignId: stringField(value, "campaignId"),
    revision: Number(revision),
    brandDisplayName: stringField(value, "brandDisplayName"),
    creativeHeadline: stringField(value, "creativeHeadline"),
    creativeBody: stringField(value, "creativeBody"),
    landingPage: stringField(value, "landingPage"),
  };
}

function parseDecision(value: unknown): ContextDecision {
  if (!isRecord(value)) invalidResponse("decision is missing");
  const status = value.status;
  if (status !== "ELIGIBLE" && status !== "SUPPRESSED" && status !== "NO_MATCH") {
    invalidResponse("decision status is invalid");
  }
  const context = recordField(value, "context");
  const ageEligibility = context.ageEligibility;
  if (
    ageEligibility !== "ADULT_DECLARED" &&
    ageEligibility !== "UNDER_18" &&
    ageEligibility !== "UNKNOWN"
  ) {
    invalidResponse("age eligibility is invalid");
  }
  if (context.personalization !== false) invalidResponse("personalization must be false");
  const topics = context.topics;
  if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== "string")) {
    invalidResponse("context topics are invalid");
  }
  const rejected = value.rejected;
  if (!Array.isArray(rejected)) invalidResponse("rejected campaigns are missing");
  const parsed: ContextDecision = {
    decisionId: stringField(value, "decisionId"),
    status,
    reasonCode: stringField(value, "reasonCode"),
    context: {
      topics,
      intent: stringField(context, "intent"),
      coarseLocale: stringField(context, "coarseLocale"),
      sensitiveClass: stringField(context, "sensitiveClass"),
      ageEligibility,
      personalization: false,
      contextCommitment: stringField(context, "contextCommitment"),
    },
    rejected: rejected.map((entry) => {
      if (!isRecord(entry)) invalidResponse("a rejected campaign is invalid");
      return {
        campaignId: stringField(entry, "campaignId"),
        reasonCode: stringField(entry, "reasonCode"),
      };
    }),
  };
  if (value.winner !== undefined) {
    const winner = value.winner;
    if (!isRecord(winner)) invalidResponse("winner is invalid");
    const revision = winner.revision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      invalidResponse("winner revision is invalid");
    }
    parsed.winner = {
      campaignId: stringField(winner, "campaignId"),
      revision: Number(revision),
      relevance: stringField(winner, "relevance"),
      campaign: parseCampaign(winner.campaign),
    };
  }
  if (parsed.status === "ELIGIBLE" && !parsed.winner)
    invalidResponse("eligible decision has no winner");
  return parsed;
}

function parsePlacement(value: unknown): Placement {
  if (!isRecord(value)) invalidResponse("placement is missing");
  const status = value.status;
  if (
    status !== "AUTHORIZED" &&
    status !== "SIGNED" &&
    status !== "PAID_VERIFIED" &&
    status !== "INVALID"
  ) {
    invalidResponse("placement status is invalid");
  }
  const quote = recordField(value, "quote");
  const subject = recordField(value, "subject");
  const authorization = recordField(value, "authorization");
  if (authorization.proofLevel !== "CRE_SIMULATED" || authorization.eligible !== true) {
    invalidResponse("placement authorization is invalid");
  }
  const parsed: Placement = {
    placementId: stringField(value, "placementId"),
    decisionId: stringField(value, "decisionId"),
    campaignId: stringField(value, "campaignId"),
    receiptId: stringField(value, "receiptId"),
    displayText: stringField(value, "displayText"),
    landingPage: stringField(value, "landingPage"),
    status,
    subject: {
      publisher: stringField(subject, "publisher"),
      placementId: stringField(subject, "placementId"),
      productRefHash: stringField(subject, "productRefHash"),
      contentHash: stringField(subject, "contentHash"),
      disclosureVersion: positiveIntegerField(subject, "disclosureVersion"),
    },
    quote: {
      schemaVersion: positiveIntegerField(quote, "schemaVersion"),
      campaignId: stringField(quote, "campaignId"),
      subjectHash: stringField(quote, "subjectHash"),
      payer: stringField(quote, "payer"),
      amount: stringField(quote, "amount"),
      asset: stringField(quote, "asset"),
      recipient: stringField(quote, "recipient"),
      validUntil: positiveIntegerField(quote, "validUntil"),
      nonce: stringField(quote, "nonce"),
      chainId: positiveIntegerField(quote, "chainId"),
      settlementContract: stringField(quote, "settlementContract"),
    },
    authorization: { proofLevel: "CRE_SIMULATED", eligible: true },
  };
  if (
    parsed.subject.placementId.toLowerCase() !== parsed.placementId.toLowerCase() ||
    parsed.quote.campaignId.toLowerCase() !== parsed.campaignId.toLowerCase()
  ) {
    invalidResponse("placement bindings do not agree");
  }
  return parsed;
}

function parseVerification(value: unknown): {
  placement: Placement;
  verification: VerificationResult;
} {
  if (!isRecord(value)) invalidResponse("verification envelope is missing");
  const verification = recordField(value, "verification");
  const status = verification.status;
  if (
    status !== "PAID_VERIFIED" &&
    status !== "PENDING" &&
    status !== "NOT_FOUND_AT_BLOCK" &&
    status !== "INVALID" &&
    status !== "UNAVAILABLE"
  )
    invalidResponse("verification status is invalid");
  return {
    placement: parsePlacement(value.placement),
    verification: { status, reason: stringField(verification, "reason") },
  };
}

function parseEvidence(value: unknown): PlacementEvidence {
  if (!isRecord(value)) invalidResponse("evidence bundle is missing");
  const campaign = recordField(value, "campaign");
  return {
    placement: parsePlacement(value.placement),
    decision: parseDecision(value.decision),
    campaign: { manifest: parseCampaign(campaign.manifest) },
  };
}

export class AdReceiptClient {
  private readonly apiBaseUrl: string;
  private readonly receiptBaseUrl?: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: AdReceiptClientOptions) {
    if (!/^https?:\/\//.test(options.apiBaseUrl) && !options.apiBaseUrl.startsWith("/")) {
      throw new Error("apiBaseUrl must be an absolute HTTP URL or a root-relative path");
    }
    this.apiBaseUrl = trimSlash(options.apiBaseUrl);
    this.receiptBaseUrl = options.receiptBaseUrl ? trimSlash(options.receiptBaseUrl) : undefined;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error("A Fetch API implementation is required");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new Error("requestTimeoutMs must be a positive integer");
    }
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(init?.signal?.reason);
    init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("AdReceipt request timed out")),
      this.requestTimeoutMs,
    );
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } finally {
      clearTimeout(timeout);
      init?.signal?.removeEventListener("abort", abortFromCaller);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdReceiptApiError(
        response.status,
        isRecord(body) && typeof body.error === "string" ? body.error : "unknown",
        isRecord(body) && typeof body.message === "string" ? body.message : response.statusText,
      );
    }
    return body;
  }

  async evaluate(input: {
    query: string;
    organicAnswer: string;
    ageEligibility: AgeEligibility;
    coarseLocale: string;
  }): Promise<PublisherResponse> {
    const decision = parseDecision(
      await this.request("/v2/decisions", {
        method: "POST",
        body: JSON.stringify({
          query: input.query,
          ageEligibility: input.ageEligibility,
          coarseLocale: input.coarseLocale,
        }),
      }),
    );
    return {
      organic: input.organicAnswer,
      decision,
      sponsorship: null,
      state:
        decision.status === "ELIGIBLE"
          ? "ELIGIBLE_PAYMENT_REQUIRED"
          : decision.status === "SUPPRESSED"
            ? "SUPPRESSED"
            : "NO_MATCH",
    };
  }

  async authorizePlacement(decisionId: string, amountAtomic: string): Promise<Placement> {
    const placement = parsePlacement(
      await this.request("/v2/placements", {
        method: "POST",
        body: JSON.stringify({ decisionId, amount: amountAtomic }),
      }),
    );
    if (placement.decisionId !== decisionId || placement.status !== "AUTHORIZED") {
      invalidResponse("authorized placement does not match the requested decision");
    }
    return placement;
  }

  async submitPublisherSignature(placementId: string, signature: string): Promise<Placement> {
    const placement = parsePlacement(
      await this.request(`/v2/placements/${encodeURIComponent(placementId)}/sign`, {
        method: "POST",
        body: JSON.stringify({ signature }),
      }),
    );
    if (
      placement.placementId.toLowerCase() !== placementId.toLowerCase() ||
      placement.status !== "SIGNED"
    ) {
      invalidResponse("signed placement does not match the submitted placement");
    }
    return placement;
  }

  async authorizeAndSign(input: {
    decisionId: string;
    amountAtomic: string;
    signTypedData: (
      typedData: ReturnType<typeof publisherQuoteTypedData>,
      placement: Placement,
    ) => Promise<string>;
  }): Promise<Placement> {
    const placement = await this.authorizePlacement(input.decisionId, input.amountAtomic);
    const signature = await input.signTypedData(publisherQuoteTypedData(placement), placement);
    if (typeof signature !== "string" || !signature) {
      throw new Error("The publisher wallet did not return a signature");
    }
    return this.submitPublisherSignature(placement.placementId, signature);
  }

  async renderVerified(input: {
    placementId: string;
    decisionId: string;
    organicAnswer: string;
  }): Promise<VerifiedPublisherResponse> {
    try {
      const checked = parseVerification(
        await this.request(`/v2/placements/${encodeURIComponent(input.placementId)}/verify`, {
          method: "POST",
        }),
      );
      if (
        checked.verification.status !== "PAID_VERIFIED" ||
        checked.placement.status !== "PAID_VERIFIED"
      ) {
        return {
          organic: input.organicAnswer,
          state: "WITHHELD",
          sponsorship: null,
          reason: checked.verification.reason,
        };
      }

      const evidence = parseEvidence(
        await this.request(
          `/v2/receipts/${encodeURIComponent(checked.placement.receiptId)}/evidence`,
        ),
      );
      const campaign = evidence.campaign.manifest;
      const expectedDisplayText = `${campaign.creativeHeadline}\n${campaign.creativeBody}`;
      if (
        evidence.placement.placementId.toLowerCase() !== input.placementId.toLowerCase() ||
        evidence.placement.receiptId.toLowerCase() !== checked.placement.receiptId.toLowerCase() ||
        evidence.placement.status !== "PAID_VERIFIED" ||
        checked.placement.decisionId !== input.decisionId ||
        evidence.placement.decisionId !== input.decisionId ||
        evidence.decision.decisionId !== input.decisionId ||
        evidence.decision.status !== "ELIGIBLE" ||
        !evidence.decision.winner ||
        checked.placement.campaignId.toLowerCase() !== campaign.campaignId.toLowerCase() ||
        evidence.placement.campaignId.toLowerCase() !== campaign.campaignId.toLowerCase() ||
        evidence.decision.winner.campaignId.toLowerCase() !== campaign.campaignId.toLowerCase() ||
        evidence.decision.winner.revision !== campaign.revision ||
        evidence.placement.displayText !== expectedDisplayText ||
        evidence.placement.landingPage !== campaign.landingPage
      ) {
        return {
          organic: input.organicAnswer,
          state: "WITHHELD",
          sponsorship: null,
          reason: "The receipt evidence does not identify the verified placement.",
        };
      }

      return {
        organic: input.organicAnswer,
        state: "VERIFIED",
        sponsorship: {
          label: "Sponsored · Verified",
          brand: campaign.brandDisplayName,
          headline: campaign.creativeHeadline,
          body: campaign.creativeBody,
          landingPage: evidence.placement.landingPage,
          receiptId: evidence.placement.receiptId,
          ...(this.receiptBaseUrl
            ? { receiptUrl: `${this.receiptBaseUrl}/receipts/${evidence.placement.receiptId}` }
            : {}),
          payment: {
            amount: evidence.placement.quote.amount,
            asset: evidence.placement.quote.asset,
            recipient: evidence.placement.quote.recipient,
          },
          proof: {
            policy: evidence.placement.authorization.proofLevel,
            payment: "PAID_VERIFIED",
            contextCommitment: evidence.decision.context.contextCommitment,
          },
        },
      };
    } catch (error) {
      return {
        organic: input.organicAnswer,
        state: "WITHHELD",
        sponsorship: null,
        reason: error instanceof Error ? error.message : "Receipt verification is unavailable.",
      };
    }
  }
}

export function createPublisherRouter(args: {
  client: AdReceiptClient;
  generateOrganic: (query: string) => Promise<string>;
}) {
  return {
    async answer(input: {
      query: string;
      ageEligibility: AgeEligibility;
      coarseLocale: string;
    }): Promise<PublisherRouterResponse> {
      const organicAnswer = await args.generateOrganic(input.query);
      try {
        return await args.client.evaluate({ ...input, organicAnswer });
      } catch (error) {
        return {
          organic: organicAnswer,
          decision: null,
          sponsorship: null,
          state: "UNAVAILABLE",
          reason:
            error instanceof Error
              ? error.message
              : "AdReceipt decision infrastructure is unavailable.",
        };
      }
    },
  };
}
