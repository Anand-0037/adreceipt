import { randomBytes } from "node:crypto";
import {
  AbiCoder,
  getAddress,
  hexlify,
  id,
  isAddress,
  isHexString,
  keccak256,
  TypedDataEncoder,
  verifyTypedData,
} from "ethers";
import { settlementDeployment } from "../config";

export const AGE_ELIGIBILITY = ["ADULT_DECLARED", "UNDER_18", "UNKNOWN"] as const;
export type AgeEligibility = (typeof AGE_ELIGIBILITY)[number];

export const INTENTS = [
  "DISCOVER_TOOL",
  "COMPARE_OPTIONS",
  "SOLVE_PROBLEM",
  "PURCHASE_RESEARCH",
] as const;
export type Intent = (typeof INTENTS)[number] | "UNCLASSIFIED";

export const TOPICS = [
  "CLOUD_INFRASTRUCTURE",
  "DATASETS",
  "DEVELOPER_TOOLS",
  "ECOMMERCE",
  "EDUCATION",
  "FINANCE",
  "MACHINE_LEARNING",
  "PRODUCTIVITY",
] as const;
export type Topic = (typeof TOPICS)[number];

export const SENSITIVE_CLASSES = [
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
export type SensitiveClass = (typeof SENSITIVE_CLASSES)[number] | "NONE" | "UNCLASSIFIED";
export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "EXPIRED";

export interface CampaignInput {
  advertiserWallet: string;
  brandDisplayName: string;
  productRef: string;
  landingPage: string;
  objective: "WEBSITE_VISIT";
  settlementAsset: string;
  totalBudget: string;
  maxPlacementAmount: string;
  targetTopics: Topic[];
  targetIntents: Exclude<Intent, "UNCLASSIFIED">[];
  allowedLocales: string[];
  blockedContextClasses: Exclude<SensitiveClass, "NONE" | "UNCLASSIFIED">[];
  creativeHeadline: string;
  creativeBody: string;
  validFrom: string;
  validUntil: string;
}

export interface CampaignManifestV2 extends CampaignInput {
  schemaVersion: 2;
  campaignId: string;
  revision: number;
  status: CampaignStatus;
  campaignRevisionHash: string;
}

export interface CampaignRecord {
  manifest: CampaignManifestV2;
  typedData: CampaignTypedData;
  advertiserSignature?: string;
  approvedAt?: string;
}

export interface CampaignTypedData {
  domain: {
    name: "AdReceipt";
    version: "2";
    chainId: number;
    verifyingContract: string;
  };
  primaryType: "CampaignManifestV2";
  types: typeof CAMPAIGN_TYPES;
  message: Record<string, string | number>;
}

export interface PublicContext {
  topics: Topic[];
  intent: Intent;
  commercialIntentBand: "LOW" | "MEDIUM" | "HIGH" | "UNCLASSIFIED";
  coarseLocale: string;
  surface: "CHAT_ANSWER";
  sensitiveClass: SensitiveClass;
  ageEligibility: AgeEligibility;
  personalization: false;
  contextCommitment: string;
}

export interface ContextDecision {
  decisionId: string;
  status: "ELIGIBLE" | "SUPPRESSED" | "NO_MATCH" | "UNAVAILABLE";
  reasonCode: string;
  context: PublicContext;
  winner?: {
    campaignId: string;
    revision: number;
    relevance: string;
    campaign: CampaignManifestV2;
  };
  rejected: { campaignId: string; reasonCode: string }[];
  /** Persisted server-side and deliberately omitted from API responses. */
  privateSalt: string;
}

const CAMPAIGN_TYPES = [
  { name: "schemaVersion", type: "uint16" },
  { name: "campaignId", type: "bytes32" },
  { name: "revision", type: "uint32" },
  { name: "advertiserWallet", type: "address" },
  { name: "brandRefHash", type: "bytes32" },
  { name: "productRefHash", type: "bytes32" },
  { name: "landingPageHash", type: "bytes32" },
  { name: "objectiveHash", type: "bytes32" },
  { name: "settlementAsset", type: "address" },
  { name: "totalBudget", type: "uint256" },
  { name: "maxPlacementAmount", type: "uint256" },
  { name: "targetingHash", type: "bytes32" },
  { name: "creativeTemplateHash", type: "bytes32" },
  { name: "validFrom", type: "uint64" },
  { name: "validUntil", type: "uint64" },
] as const;

export const CAMPAIGN_ACTION_TYPES = [
  { name: "campaignId", type: "bytes32" },
  { name: "campaignRevisionHash", type: "bytes32" },
  { name: "actionHash", type: "bytes32" },
  { name: "validUntil", type: "uint64" },
] as const;

const CONTEXT_TYPES = {
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
};

const TOPIC_TERMS: Record<Topic, RegExp> = {
  CLOUD_INFRASTRUCTURE: /\b(cloud|hosting|server|deploy|kubernetes|docker|gpu)\b/i,
  DATASETS: /\b(dataset|datasets|kaggle|training data|data loader)\b/i,
  DEVELOPER_TOOLS: /\b(api|sdk|developer|coding|code|terminal|ide|database|postgres)\b/i,
  ECOMMERCE: /\b(shop|store|e-?commerce|checkout|retail|product catalog)\b/i,
  EDUCATION: /\b(course|learn|tutorial|education|study|training)\b/i,
  FINANCE: /\b(accounting|invoice|payments?|banking|fintech|budgeting)\b/i,
  MACHINE_LEARNING:
    /\b(machine learning|\bml\b|ai agent|artificial intelligence|model|embedding)\b/i,
  PRODUCTIVITY: /\b(productivity|workflow|automation|project management|calendar|notes)\b/i,
};

const SENSITIVE_TERMS: [Exclude<SensitiveClass, "NONE" | "UNCLASSIFIED">, RegExp][] = [
  ["SELF_HARM", /\b(suicide|kill myself|self[- ]harm|end my life)\b/i],
  ["MENTAL_HEALTH", /\b(depress(?:ed|ion)?|anxiety|panic attack|mental health|therap(?:y|ist))\b/i],
  ["HEALTH", /\b(symptom|diagnos(?:e|is)|medication|doctor|hospital|disease|personal health)\b/i],
  ["POLITICS", /\b(election|politic(?:s|al)|candidate|vote|government policy)\b/i],
  ["MINORS", /\b(child|children|minor|under 18|teenager|kid)\b/i],
  ["SEXUAL_CONTENT", /\b(porn|sexual|explicit content)\b/i],
  ["GAMBLING", /\b(casino|gambling|sports bet|betting)\b/i],
  ["WEAPONS", /\b(gun|firearm|weapon|ammunition|explosive)\b/i],
  ["DRUGS_ALCOHOL", /\b(cocaine|heroin|recreational drugs?|buy alcohol|liquor)\b/i],
  ["DANGEROUS_ILLEGAL", /\b(hack into|steal|fraud|counterfeit|illegal|build a bomb)\b/i],
];

const abi = AbiCoder.defaultAbiCoder();

function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const normalized = value.replace(/\r\n/g, "\n").normalize("NFC").trim();
  if (!normalized || normalized.length > max)
    throw new Error(`${field} must be 1-${max} characters`);
  return normalized;
}

function atomic(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${field} must be a positive base-10 atomic amount`);
  }
  return value;
}

function unix(value: unknown, field: string): string {
  const parsed = atomic(value, field);
  if (BigInt(parsed) > 18_446_744_073_709_551_615n) throw new Error(`${field} exceeds uint64`);
  return parsed;
}

function enumList<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must not be empty`);
  const normalized = [...new Set(value.map((item) => String(item).trim().toUpperCase()))].sort();
  for (const item of normalized)
    if (!allowed.includes(item as T)) throw new Error(`${field} contains ${item}`);
  return normalized as T[];
}

export function normalizeUrl(value: unknown): string {
  const parsed = new URL(text(value, "landingPage", 2048));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("landingPage must be an https URL without credentials or a fragment");
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port === "443") parsed.port = "";
  return parsed.toString();
}

function hashList(values: string[]): string {
  return keccak256(abi.encode(["bytes32[]"], [values.map((value) => id(value))]));
}

export function parseCampaignInput(value: unknown): CampaignInput {
  if (!value || typeof value !== "object") throw new Error("campaign body must be an object");
  const input = value as Record<string, unknown>;
  if (!isAddress(String(input.advertiserWallet ?? "")))
    throw new Error("advertiserWallet is invalid");
  if (!isAddress(String(input.settlementAsset ?? "")))
    throw new Error("settlementAsset is invalid");
  const totalBudget = atomic(input.totalBudget, "totalBudget");
  const maxPlacementAmount = atomic(input.maxPlacementAmount, "maxPlacementAmount");
  if (BigInt(maxPlacementAmount) > BigInt(totalBudget)) {
    throw new Error("maxPlacementAmount cannot exceed totalBudget");
  }
  if (input.objective !== "WEBSITE_VISIT") throw new Error("objective must be WEBSITE_VISIT");
  const allowedLocales = Array.isArray(input.allowedLocales)
    ? [...new Set(input.allowedLocales.map((item) => text(item, "allowedLocales", 35)))].sort()
    : [];
  if (allowedLocales.length === 0) throw new Error("allowedLocales must not be empty");

  const validFrom = unix(input.validFrom, "validFrom");
  const validUntil = unix(input.validUntil, "validUntil");
  if (BigInt(validUntil) <= BigInt(validFrom)) throw new Error("validUntil must follow validFrom");

  return {
    advertiserWallet: getAddress(String(input.advertiserWallet)),
    brandDisplayName: text(input.brandDisplayName, "brandDisplayName", 120),
    productRef: text(input.productRef, "productRef", 500),
    landingPage: normalizeUrl(input.landingPage),
    objective: "WEBSITE_VISIT",
    settlementAsset: getAddress(String(input.settlementAsset)),
    totalBudget,
    maxPlacementAmount,
    targetTopics: enumList(input.targetTopics, TOPICS, "targetTopics"),
    targetIntents: enumList(input.targetIntents, INTENTS, "targetIntents"),
    allowedLocales,
    blockedContextClasses: enumList(
      input.blockedContextClasses,
      SENSITIVE_CLASSES,
      "blockedContextClasses",
    ),
    creativeHeadline: text(input.creativeHeadline, "creativeHeadline", 120),
    creativeBody: text(input.creativeBody, "creativeBody", 300),
    validFrom,
    validUntil,
  };
}

export function buildCampaign(
  raw: unknown,
  campaignId = hexlify(randomBytes(32)),
  revision = 1,
): CampaignRecord {
  const input = parseCampaignInput(raw);
  const targetingHash = TypedDataEncoder.hashStruct(
    "TargetingV2",
    {
      TargetingV2: [
        { name: "topicsHash", type: "bytes32" },
        { name: "intentsHash", type: "bytes32" },
        { name: "localesHash", type: "bytes32" },
        { name: "blockedClassesHash", type: "bytes32" },
        { name: "personalization", type: "bool" },
      ],
    },
    {
      topicsHash: hashList(input.targetTopics),
      intentsHash: hashList(input.targetIntents),
      localesHash: hashList(input.allowedLocales),
      blockedClassesHash: hashList(input.blockedContextClasses),
      personalization: false,
    },
  );
  const creativeTemplateHash = TypedDataEncoder.hashStruct(
    "CreativeTemplateV2",
    {
      CreativeTemplateV2: [
        { name: "headlineHash", type: "bytes32" },
        { name: "bodyHash", type: "bytes32" },
        { name: "landingPageHash", type: "bytes32" },
      ],
    },
    {
      headlineHash: id(input.creativeHeadline),
      bodyHash: id(input.creativeBody),
      landingPageHash: id(input.landingPage),
    },
  );
  const message = {
    schemaVersion: 2,
    campaignId,
    revision,
    advertiserWallet: input.advertiserWallet,
    brandRefHash: id(input.brandDisplayName),
    productRefHash: id(input.productRef),
    landingPageHash: id(input.landingPage),
    objectiveHash: id(input.objective),
    settlementAsset: input.settlementAsset,
    totalBudget: input.totalBudget,
    maxPlacementAmount: input.maxPlacementAmount,
    targetingHash,
    creativeTemplateHash,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
  };
  const campaignRevisionHash = TypedDataEncoder.hashStruct(
    "CampaignManifestV2",
    { CampaignManifestV2: CAMPAIGN_TYPES as unknown as { name: string; type: string }[] },
    message,
  );
  return {
    manifest: {
      schemaVersion: 2,
      campaignId,
      revision,
      status: "DRAFT",
      campaignRevisionHash,
      ...input,
    },
    typedData: {
      domain: {
        name: "AdReceipt",
        version: "2",
        chainId: settlementDeployment.chainId,
        verifyingContract: settlementDeployment.address,
      },
      primaryType: "CampaignManifestV2",
      types: CAMPAIGN_TYPES,
      message,
    },
  };
}

export function verifyCampaignApproval(record: CampaignRecord, signature: string): string {
  const recovered = verifyTypedData(
    record.typedData.domain,
    { CampaignManifestV2: CAMPAIGN_TYPES as unknown as { name: string; type: string }[] },
    record.typedData.message,
    signature,
  );
  if (recovered.toLowerCase() !== record.manifest.advertiserWallet.toLowerCase()) {
    throw new Error("signature does not belong to the advertiser wallet");
  }
  return getAddress(recovered);
}

export function verifyCampaignAction(
  record: CampaignRecord,
  action: "PAUSE",
  validUntil: unknown,
  signature: unknown,
  now = Math.floor(Date.now() / 1_000),
): string {
  if (!Number.isSafeInteger(validUntil) || Number(validUntil) <= now) {
    throw new Error("campaign action has expired");
  }
  if (Number(validUntil) > now + 5 * 60) {
    throw new Error("campaign action expiry exceeds five minutes");
  }
  if (typeof signature !== "string" || !isHexString(signature, 65)) {
    throw new Error("campaign action signature is invalid");
  }
  const recovered = verifyTypedData(
    record.typedData.domain,
    { CampaignActionV2: CAMPAIGN_ACTION_TYPES as unknown as { name: string; type: string }[] },
    {
      campaignId: record.manifest.campaignId,
      campaignRevisionHash: record.manifest.campaignRevisionHash,
      actionHash: id(action),
      validUntil: Number(validUntil),
    },
    signature,
  );
  if (recovered.toLowerCase() !== record.manifest.advertiserWallet.toLowerCase()) {
    throw new Error("campaign action signature does not belong to the advertiser wallet");
  }
  return getAddress(recovered);
}

function sensitiveClass(query: string): SensitiveClass {
  return SENSITIVE_TERMS.find(([, pattern]) => pattern.test(query))?.[0] ?? "NONE";
}

function inferTopics(query: string): Topic[] {
  return TOPICS.filter((topic) => TOPIC_TERMS[topic].test(query));
}

function inferIntent(query: string, topics: Topic[]): Intent {
  if (/\b(buy|price|pricing|cost|subscribe|purchase)\b/i.test(query)) return "PURCHASE_RESEARCH";
  if (/\b(compare|versus|\bvs\b|best|alternative|which)\b/i.test(query)) return "COMPARE_OPTIONS";
  if (
    topics.length > 0 &&
    (/\b(find|recommend|tool|platform|provider|service|good way)\b/i.test(query) ||
      /\b(?:what|which)\s+(?:\w+\s+){0,3}(?:tool|platform|provider|service)\b/i.test(query))
  ) {
    return "DISCOVER_TOOL";
  }
  if (/\b(how|fix|solve|integrate|manage|load|access|download)\b/i.test(query))
    return "SOLVE_PROBLEM";
  return "UNCLASSIFIED";
}

export function hashContextEnvelope(
  context: Omit<PublicContext, "contextCommitment">,
  salt: string,
): string {
  const band = { UNCLASSIFIED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 }[context.commercialIntentBand];
  const sensitive = ["NONE", ...SENSITIVE_CLASSES, "UNCLASSIFIED"].indexOf(context.sensitiveClass);
  const age = AGE_ELIGIBILITY.indexOf(context.ageEligibility);
  return TypedDataEncoder.hashStruct("SanitizedContextV2", CONTEXT_TYPES, {
    schemaVersion: 2,
    topicsHash: hashList(context.topics),
    intentHash: id(context.intent),
    commercialIntentBand: band,
    coarseLocaleHash: id(context.coarseLocale),
    surfaceHash: id(context.surface),
    sensitiveClass: sensitive,
    ageEligibility: age,
    personalization: false,
    salt,
  });
}

export function decideCampaign(args: {
  decisionId: string;
  query: unknown;
  ageEligibility: unknown;
  coarseLocale?: unknown;
  campaigns: CampaignRecord[];
  now?: number;
}): ContextDecision {
  const query = text(args.query, "query", 2_000);
  if (!AGE_ELIGIBILITY.includes(args.ageEligibility as AgeEligibility)) {
    throw new Error("ageEligibility is invalid");
  }
  const ageEligibility = args.ageEligibility as AgeEligibility;
  const coarseLocale = args.coarseLocale ? text(args.coarseLocale, "coarseLocale", 35) : "en";
  const topics = inferTopics(query);
  const intent = inferIntent(query, topics);
  const sensitive = sensitiveClass(query);
  const commercialIntentBand: PublicContext["commercialIntentBand"] =
    intent === "PURCHASE_RESEARCH" || intent === "COMPARE_OPTIONS" || intent === "DISCOVER_TOOL"
      ? "HIGH"
      : intent === "SOLVE_PROBLEM"
        ? "MEDIUM"
        : "UNCLASSIFIED";
  const privateSalt = hexlify(randomBytes(32));
  const core: Omit<PublicContext, "contextCommitment"> = {
    topics,
    intent,
    commercialIntentBand,
    coarseLocale,
    surface: "CHAT_ANSWER",
    sensitiveClass: sensitive,
    ageEligibility,
    personalization: false as const,
  };
  const context = { ...core, contextCommitment: hashContextEnvelope(core, privateSalt) };
  const suppressed = (reasonCode: string): ContextDecision => ({
    decisionId: args.decisionId,
    status: "SUPPRESSED",
    reasonCode,
    context,
    rejected: [],
    privateSalt,
  });
  if (ageEligibility !== "ADULT_DECLARED") return suppressed("AGE_NOT_ELIGIBLE");
  if (sensitive !== "NONE") return suppressed("SENSITIVE_CONTEXT");
  if (intent === "UNCLASSIFIED" || topics.length === 0) return suppressed("CONTEXT_UNCLASSIFIED");

  const now = args.now ?? Math.floor(Date.now() / 1_000);
  const rejected: { campaignId: string; reasonCode: string }[] = [];
  const eligible: { record: CampaignRecord; relevance: number }[] = [];
  for (const record of args.campaigns) {
    const campaign = record.manifest;
    if (campaign.status !== "ACTIVE") {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "NO_ACTIVE_CAMPAIGN" });
      continue;
    }
    if (BigInt(campaign.validFrom) > BigInt(now) || BigInt(campaign.validUntil) <= BigInt(now)) {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "OUTSIDE_CAMPAIGN_WINDOW" });
      continue;
    }
    if (
      !campaign.allowedLocales.some((locale) =>
        coarseLocale.toLowerCase().startsWith(locale.toLowerCase()),
      )
    ) {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "LOCALE_NOT_ALLOWED" });
      continue;
    }
    const overlap = campaign.targetTopics.filter((topic) => topics.includes(topic)).length;
    if (overlap === 0) {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "TOPIC_NOT_ALLOWED" });
      continue;
    }
    if (!campaign.targetIntents.includes(intent as Exclude<Intent, "UNCLASSIFIED">)) {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "INTENT_NOT_ALLOWED" });
      continue;
    }
    const relevance = 0.7 * (overlap / campaign.targetTopics.length) + 0.3;
    if (relevance < 0.72) {
      rejected.push({ campaignId: campaign.campaignId, reasonCode: "BELOW_RELEVANCE_FLOOR" });
      continue;
    }
    eligible.push({ record, relevance });
  }
  eligible.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      a.record.manifest.campaignId.localeCompare(b.record.manifest.campaignId),
  );
  const winner = eligible[0];
  if (!winner) {
    return {
      decisionId: args.decisionId,
      status: "NO_MATCH",
      reasonCode:
        args.campaigns.length === 0
          ? "NO_ACTIVE_CAMPAIGN"
          : (rejected[0]?.reasonCode ?? "NO_ELIGIBLE_CAMPAIGN"),
      context,
      rejected,
      privateSalt,
    };
  }
  return {
    decisionId: args.decisionId,
    status: "ELIGIBLE",
    reasonCode: "MATCHED",
    context,
    winner: {
      campaignId: winner.record.manifest.campaignId,
      revision: winner.record.manifest.revision,
      relevance: winner.relevance.toFixed(2),
      campaign: winner.record.manifest,
    },
    rejected,
    privateSalt,
  };
}
