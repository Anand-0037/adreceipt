export const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "/api";

export type ReceiptStatus =
  | "PAID_VERIFIED"
  | "PENDING"
  | "NOT_FOUND_AT_BLOCK"
  | "INVALID"
  | "UNAVAILABLE";

export interface ReceiptEvidence {
  id: string;
  campaignId: string;
  subjectHash: string;
  publisher: string;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  settledAt: string;
  schemaVersion: number;
  settlementContract: string;
  transactionHash: string;
  logIndex: string;
  blockNumber: string;
  blockTimestamp: string;
}

export interface VerificationResult {
  status: ReceiptStatus;
  reason: string;
  evidence?: {
    graph: {
      receipt: ReceiptEvidence | null;
      blockNumber: number;
      hasIndexingErrors: boolean;
    };
    rpcHead: number;
    rpc?: { chainId: number; receipt: ReceiptEvidence };
  };
}

export interface Health {
  ok: boolean;
  network: string;
  chainId: number;
  block: number;
  settlement: {
    address: string;
    asset: string;
    deploymentBlock: number;
    deploymentTransaction: string;
  };
  graph: { configured: boolean };
  privy: {
    configured: boolean;
    credentials: boolean;
    wallet: "configured" | "missing";
    policy: "configured" | "missing";
    authorizationKey: "configured" | "missing";
    providerVerified: boolean;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseVerification(value: unknown): VerificationResult {
  if (!isObject(value) || typeof value.status !== "string" || typeof value.reason !== "string") {
    throw new ApiError(502, "invalid-response", "The verifier returned an invalid response.");
  }
  const statuses: ReceiptStatus[] = [
    "PAID_VERIFIED",
    "PENDING",
    "NOT_FOUND_AT_BLOCK",
    "INVALID",
    "UNAVAILABLE",
  ];
  if (!statuses.includes(value.status as ReceiptStatus)) {
    throw new ApiError(502, "invalid-response", "The verifier returned an unknown status.");
  }
  return value as unknown as VerificationResult;
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  const unavailableVerification =
    response.status === 503 && isObject(body) && body.status === "UNAVAILABLE";
  if (!response.ok && !unavailableVerification) {
    const error = isObject(body) ? body : {};
    throw new ApiError(
      response.status,
      typeof error.error === "string" ? error.error : "unknown",
      typeof error.message === "string" ? error.message : response.statusText,
    );
  }
  return body;
}

export const api = {
  health: async () => (await get("/health")) as Health,
  verifyReceipt: async (receiptId: string, atBlock?: number) => {
    const query = atBlock ? `?atBlock=${atBlock}` : "";
    return parseVerification(await get(`/receipts/${encodeURIComponent(receiptId)}${query}`));
  },
  verifySubject: async (subjectHash: string) =>
    parseVerification(await get(`/subjects/${encodeURIComponent(subjectHash)}`)),
};

export const explorer = {
  address: (address: string) => `https://sepolia.etherscan.io/address/${address}`,
  tx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  block: (block: string | number) => `https://sepolia.etherscan.io/block/${block}`,
};

export interface LedgerData {
  count: number;
  totalAmount: string;
  receipts: ReceiptEvidence[];
  sponsors: { address: string; paid: string; placements: number }[];
  publishers: { address: string; earned: string; placements: number }[];
  indexedBlock: number;
  rpcHead: number;
  hasIndexingErrors: false;
  verification: "PAID_VERIFIED";
  limit: number;
  hasMore: boolean;
}

function parseLedger(value: unknown): LedgerData {
  if (
    !isObject(value) ||
    !Array.isArray(value.receipts) ||
    !Array.isArray(value.sponsors) ||
    !Array.isArray(value.publishers) ||
    value.verification !== "PAID_VERIFIED" ||
    value.hasIndexingErrors !== false ||
    typeof value.indexedBlock !== "number" ||
    typeof value.rpcHead !== "number"
  ) {
    throw new ApiError(502, "invalid-response", "The ledger returned invalid evidence.");
  }
  return value as unknown as LedgerData;
}

export const ledgerApi = {
  all: async () => parseLedger(await get("/receipts")),
  byPayer: async (address: string) => {
    const value = await get(`/payers/${encodeURIComponent(address)}/receipts`);
    if (
      !isObject(value) ||
      typeof value.address !== "string" ||
      value.address.toLowerCase() !== address.toLowerCase()
    ) {
      throw new ApiError(502, "invalid-response", "The payer ledger returned invalid evidence.");
    }
    return value as unknown as Omit<LedgerData, "totalAmount" | "sponsors" | "publishers"> & {
      address: string;
    };
  },
};

// ---------------------------------------------------------------------------
// Domain control
//
// Reading is public and costs nothing; recording requires the wallet's own
// signature. A failed check is never written on-chain, so a bad moment for DNS
// can never revoke a legitimate advertiser.
// ---------------------------------------------------------------------------

export type ControlState =
  | "controlled"
  | "record-missing"
  | "record-mismatch"
  | "not-registered"
  | "undetermined";

export interface DomainControl {
  address: string;
  registered: boolean;
  name?: string;
  domain?: string;
  /** What the registry holds, which may lag a live DNS change. */
  recordedOnChain?: boolean;
  state: ControlState;
  message: string;
  recordable?: boolean;
  checkedAt?: number;
  resolversAnswered?: number;
  record?: { name: string; type: "TXT"; value: string; instructions: string[] };
}

export interface DomainAuthorisation {
  address: string;
  domain: string;
  chainId: number;
  challenge: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  expiresInSeconds: number;
  message: string;
}

export interface AttestResult {
  address: string;
  attested: boolean;
  state: ControlState;
  message: string;
  transaction?: { hash: string; blockNumber: number };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? "unknown",
      (body as { message?: string }).message ?? response.statusText,
    );
  }
  return body as T;
}

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "EXPIRED";
export type AgeEligibility = "ADULT_DECLARED" | "UNDER_18" | "UNKNOWN";

export interface CampaignManifestV2 {
  schemaVersion: 2;
  campaignId: string;
  revision: number;
  status: CampaignStatus;
  campaignRevisionHash: string;
  advertiserWallet: string;
  brandDisplayName: string;
  productRef: string;
  landingPage: string;
  objective: "WEBSITE_VISIT";
  settlementAsset: string;
  totalBudget: string;
  maxPlacementAmount: string;
  targetTopics: string[];
  targetIntents: string[];
  allowedLocales: string[];
  blockedContextClasses: string[];
  creativeHeadline: string;
  creativeBody: string;
  validFrom: string;
  validUntil: string;
}

export interface CampaignTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  primaryType: string;
  types: readonly { readonly name: string; readonly type: string }[];
  message: Record<string, string | number>;
}

export interface CampaignRecordV2 {
  manifest: CampaignManifestV2;
  typedData: CampaignTypedData;
  advertiserSignature?: string;
  approvedAt?: string;
}

export interface CampaignInputV2 {
  advertiserWallet: string;
  brandDisplayName: string;
  productRef: string;
  landingPage: string;
  objective: "WEBSITE_VISIT";
  settlementAsset: string;
  totalBudget: string;
  maxPlacementAmount: string;
  targetTopics: string[];
  targetIntents: string[];
  allowedLocales: string[];
  blockedContextClasses: string[];
  creativeHeadline: string;
  creativeBody: string;
  validFrom: string;
  validUntil: string;
}

export interface ContextDecisionV2 {
  decisionId: string;
  status: "ELIGIBLE" | "SUPPRESSED" | "NO_MATCH" | "UNAVAILABLE";
  reasonCode: string;
  context: {
    topics: string[];
    intent: string;
    commercialIntentBand: string;
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
    campaign: CampaignManifestV2;
  };
  rejected: { campaignId: string; reasonCode: string }[];
}

export interface PlacementRecordV2 {
  placementId: string;
  decisionId: string;
  campaignId: string;
  ticket: {
    schemaVersion: 2;
    ticketNonce: string;
    campaignId: string;
    campaignRevisionHash: string;
    publisher: string;
    contextCommitment: string;
    productRefHash: string;
    contentHash: string;
    policyCommitment: string;
    policyProofLevel: 1;
    asset: string;
    amount: string;
    validUntil: string;
    chainId: string;
    settlementContract: string;
  };
  subject: {
    publisher: string;
    placementId: string;
    productRefHash: string;
    contentHash: string;
    disclosureVersion: 2;
  };
  quote: {
    schemaVersion: 1;
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
  authorization: {
    proofLevel: "CRE_SIMULATED";
    eligible: true;
    ticketCommitment: string;
    quoteId: string;
    campaignRevisionHash: string;
    contextCommitment: string;
    policyCommitment: string;
    policyProofLevel: 1;
    simulation: { broadcast: false };
  };
  signedQuote?: {
    subject: PlacementRecordV2["subject"];
    quote: PlacementRecordV2["quote"];
    signature: string;
    receiptId: string;
  };
  receiptId: string;
  displayText: string;
  landingPage: string;
  status: "AUTHORIZED" | "SIGNED" | "PAID_VERIFIED" | "INVALID";
}

export interface PlacementMetricsV2 {
  campaignId: string;
  verifiedPlacements: number;
  spendAtomic: string;
  impressions: number;
  clicks: number;
  ctrPercent: string | null;
  effectiveCpcAtomic: string | null;
  effectiveCpmAtomic: string | null;
}

export interface V2RuntimeStatus {
  schemaVersion: 2;
  storage: "configured" | "unavailable";
  organicAnswer: "configured-unverified" | "unavailable";
  policyProofLevel: "CRE_SIMULATED";
  settlement: "PlacementSettlementV1";
  placementBindings:
    | {
        publisher: string;
        payer: string;
        recipient: string;
      }
    | "unavailable";
}

export interface PlacementEvidenceBundleV2 {
  placement: PlacementRecordV2;
  decision: ContextDecisionV2;
  campaign: CampaignRecordV2;
}

export const campaignApi = {
  suggest: (input: { brief: string; brandDisplayName: string; productRef: string }) =>
    request<{
      targetTopics: string[];
      targetIntents: string[];
      creativeHeadline: string;
      creativeBody: string;
      provider: "GroqCloud";
      model: string;
      requiresHumanApproval: true;
    }>("/v2/campaigns/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  create: (input: CampaignInputV2) =>
    request<CampaignRecordV2>("/v2/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  list: () => request<{ campaigns: CampaignRecordV2[] }>("/v2/campaigns"),
  approve: (campaign: CampaignRecordV2, signature: string) =>
    request<CampaignRecordV2>(
      `/v2/campaigns/${campaign.manifest.campaignId}/revisions/${campaign.manifest.revision}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revisionHash: campaign.manifest.campaignRevisionHash,
          signature,
        }),
      },
    ),
  pause: (campaignId: string, signature: string, validUntil: number) =>
    request<CampaignRecordV2>(`/v2/campaigns/${campaignId}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, validUntil }),
    }),
  decide: (query: string, ageEligibility: AgeEligibility, coarseLocale = "en") =>
    request<ContextDecisionV2>("/v2/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, ageEligibility, coarseLocale }),
    }),
  answer: (query: string) =>
    request<{ text: string; provider: "GroqCloud"; model: string; storedByApplication: false }>(
      "/v2/answers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      },
    ),
};

export const placementApi = {
  status: () => request<V2RuntimeStatus>("/v2/status"),
  get: (placementId: string) =>
    request<PlacementRecordV2>(`/v2/placements/${encodeURIComponent(placementId)}`),
  evidence: (receiptId: string) =>
    request<PlacementEvidenceBundleV2>(`/v2/receipts/${encodeURIComponent(receiptId)}/evidence`),
  prepare: (input: { decisionId: string; amount: string }) =>
    request<PlacementRecordV2>("/v2/placements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  sign: (placementId: string, signature: string) =>
    request<PlacementRecordV2>(`/v2/placements/${placementId}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    }),
  verify: (placementId: string) =>
    request<{ placement: PlacementRecordV2; verification: VerificationResult }>(
      `/v2/placements/${placementId}/verify`,
      { method: "POST" },
    ),
  measure: (
    placementId: string,
    kind: "IMPRESSION" | "CLICK",
    eventId: string,
    sessionId: string,
  ) =>
    request<PlacementMetricsV2>(`/v2/placements/${placementId}/measurements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, eventId, sessionId }),
    }),
  metrics: (campaignId: string) =>
    request<PlacementMetricsV2>(`/v2/campaigns/${campaignId}/metrics`),
};

export const domainApi = {
  /** Live DNS check. No gas, no writes, no authentication needed. */
  status: (address: string) => request<DomainControl>(`/advertisers/${address}/domain`),

  authorisation: (address: string) =>
    request<DomainAuthorisation>(`/advertisers/${address}/domain/authorisation`),

  attest: (authorisation: DomainAuthorisation, signature: string) =>
    request<AttestResult>(`/advertisers/${authorisation.address}/domain/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: authorisation.address,
        domain: authorisation.domain,
        chainId: authorisation.chainId,
        challenge: authorisation.challenge,
        nonce: authorisation.nonce,
        issuedAt: authorisation.issuedAt,
        expiresAt: authorisation.expiresAt,
        signature,
      }),
    }),
};
