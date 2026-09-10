import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { id, Wallet } from "ethers";
import vectors from "../../../shared/vectors/placement-ticket-v2.json";
import {
  buildCampaign,
  CAMPAIGN_ACTION_TYPES,
  decideCampaign,
  hashContextEnvelope,
  normalizeLocale,
  type CampaignInput,
  type PublicContext,
  verifyCampaignAction,
  verifyCampaignApproval,
} from "./campaign";
import { assertCampaignBudget } from "./store";

test("backend context commitment matches the application and CRE vector", () => {
  const context = vectors.context as Omit<PublicContext, "contextCommitment">;
  assert.equal(
    hashContextEnvelope(context, vectors.contextSalt),
    vectors.expected.contextCommitment,
  );
});

const wallet = Wallet.createRandom();
const now = 1_800_000_000;
const input: CampaignInput = {
  advertiserWallet: wallet.address,
  brandDisplayName: "KaggleIngest",
  productRef: "kaggle-ingest",
  landingPage: "https://example.com/kaggle-ingest",
  objective: "WEBSITE_VISIT",
  settlementAsset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  totalBudget: "10000000",
  maxPlacementAmount: "100000",
  targetTopics: ["DATASETS", "DEVELOPER_TOOLS", "MACHINE_LEARNING"],
  targetIntents: ["SOLVE_PROBLEM", "DISCOVER_TOOL", "COMPARE_OPTIONS"],
  allowedLocales: ["en"],
  blockedContextClasses: ["HEALTH", "MENTAL_HEALTH", "SELF_HARM", "POLITICS", "MINORS"],
  creativeHeadline: "Load Kaggle datasets from your coding agent",
  creativeBody: "Use KaggleIngest to move dataset discovery into your development workflow.",
  validFrom: String(now - 60),
  validUntil: String(now + 3_600),
};

async function activeCampaign() {
  const record = buildCampaign(input, `0x${"11".repeat(32)}`);
  const signature = await wallet.signTypedData(
    record.typedData.domain,
    { CampaignManifestV2: record.typedData.types as unknown as { name: string; type: string }[] },
    record.typedData.message,
  );
  verifyCampaignApproval(record, signature);
  return { ...record, manifest: { ...record.manifest, status: "ACTIVE" as const } };
}

test("campaign hash and approval bind the advertiser input", async () => {
  const record = buildCampaign(input, `0x${"22".repeat(32)}`);
  const signature = await wallet.signTypedData(
    record.typedData.domain,
    { CampaignManifestV2: record.typedData.types as unknown as { name: string; type: string }[] },
    record.typedData.message,
  );
  assert.equal(verifyCampaignApproval(record, signature), wallet.address);
  const changed = buildCampaign(
    { ...input, creativeHeadline: "Changed" },
    record.manifest.campaignId,
  );
  assert.notEqual(changed.manifest.campaignRevisionHash, record.manifest.campaignRevisionHash);
});

test("campaign and request locales use canonical BCP 47 values", async () => {
  assert.equal(normalizeLocale("EN-us"), "en-US");
  const record = buildCampaign({ ...input, allowedLocales: ["EN-us", "en-US"] });
  assert.deepEqual(record.manifest.allowedLocales, ["en-US"]);
  assert.throws(() => buildCampaign({ ...input, allowedLocales: ["not_a_locale"] }), /BCP 47/);
});

test("campaign pause requires a fresh advertiser action signature", async () => {
  const record = await activeCampaign();
  const validUntil = now + 300;
  const message = {
    campaignId: record.manifest.campaignId,
    campaignRevisionHash: record.manifest.campaignRevisionHash,
    actionHash: id("PAUSE"),
    validUntil,
  };
  const signature = await wallet.signTypedData(
    record.typedData.domain,
    { CampaignActionV2: [...CAMPAIGN_ACTION_TYPES] },
    message,
  );
  assert.equal(verifyCampaignAction(record, "PAUSE", validUntil, signature, now), wallet.address);
  assert.throws(() => verifyCampaignAction(record, "PAUSE", now, signature, now), /expired/);
  const attacker = Wallet.createRandom();
  const forged = await attacker.signTypedData(
    record.typedData.domain,
    { CampaignActionV2: [...CAMPAIGN_ACTION_TYPES] },
    message,
  );
  assert.throws(
    () => verifyCampaignAction(record, "PAUSE", validUntil, forged, now),
    /does not belong/,
  );
});

test("unknown age suppresses advertising before matching", async () => {
  const decision = decideCampaign({
    decisionId: randomUUID(),
    query: "What is the best tool for loading Kaggle datasets?",
    ageEligibility: "UNKNOWN",
    campaigns: [await activeCampaign()],
    now,
  });
  assert.equal(decision.status, "SUPPRESSED");
  assert.equal(decision.reasonCode, "AGE_NOT_ELIGIBLE");
});

test("sensitive context suppresses an otherwise commercial query", async () => {
  const decision = decideCampaign({
    decisionId: randomUUID(),
    query: "I am depressed. Which AI tool should I buy?",
    ageEligibility: "ADULT_DECLARED",
    campaigns: [await activeCampaign()],
    now,
  });
  assert.equal(decision.status, "SUPPRESSED");
  assert.equal(decision.reasonCode, "SENSITIVE_CONTEXT");
  assert.equal(decision.context.sensitiveClass, "MENTAL_HEALTH");
});

test("eligible context selects a relevant active campaign", async () => {
  const decision = decideCampaign({
    decisionId: randomUUID(),
    query: "How can I load Kaggle datasets into my coding agent?",
    ageEligibility: "ADULT_DECLARED",
    campaigns: [await activeCampaign()],
    now,
  });
  assert.equal(decision.status, "ELIGIBLE");
  assert.equal(decision.reasonCode, "MATCHED");
  assert.equal(decision.winner?.campaign.productRef, "kaggle-ingest");
  assert.equal("query" in decision.context, false);
  assert.equal("privateSalt" in decision.context, false);
});

test("language-wide campaigns accept regional locales without weakening regional targeting", async () => {
  const broad = await activeCampaign();
  const regional = await activeCampaign();
  regional.manifest.allowedLocales = ["en-US"];

  const broadDecision = decideCampaign({
    decisionId: randomUUID(),
    query: "How can I load Kaggle datasets into my coding agent?",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "EN-in",
    campaigns: [broad],
    now,
  });
  assert.equal(broadDecision.status, "ELIGIBLE");
  assert.equal(broadDecision.context.coarseLocale, "en-IN");

  const regionalDecision = decideCampaign({
    decisionId: randomUUID(),
    query: "How can I load Kaggle datasets into my coding agent?",
    ageEligibility: "ADULT_DECLARED",
    coarseLocale: "en-IN",
    campaigns: [regional],
    now,
  });
  assert.equal(regionalDecision.status, "NO_MATCH");
  assert.equal(regionalDecision.reasonCode, "LOCALE_NOT_ALLOWED");
});

test("a tool-discovery question is not downgraded by the problem it should solve", async () => {
  const campaign = await activeCampaign();
  campaign.manifest.targetIntents = ["DISCOVER_TOOL"];
  const decision = decideCampaign({
    decisionId: randomUUID(),
    query: "What tool should I use to load Kaggle datasets into my coding agent?",
    ageEligibility: "ADULT_DECLARED",
    campaigns: [campaign],
    now,
  });
  assert.equal(decision.status, "ELIGIBLE");
  assert.equal(decision.context.intent, "DISCOVER_TOOL");
});

test("an irrelevant campaign is excluded before any bid can matter", async () => {
  const campaign = await activeCampaign();
  const irrelevant = {
    ...campaign,
    manifest: { ...campaign.manifest, targetTopics: ["ECOMMERCE" as const] },
  };
  const decision = decideCampaign({
    decisionId: randomUUID(),
    query: "How can I load Kaggle datasets into my coding agent?",
    ageEligibility: "ADULT_DECLARED",
    campaigns: [irrelevant],
    now,
  });
  assert.equal(decision.status, "NO_MATCH");
  assert.equal(decision.reasonCode, "TOPIC_NOT_ALLOWED");
  assert.equal(decision.rejected[0]?.reasonCode, "TOPIC_NOT_ALLOWED");
});

test("campaign budget includes indexed spend and active signed reservations", () => {
  assert.doesNotThrow(() =>
    assertCampaignBudget({ total: 1_000n, indexed: 400n, reserved: 300n, next: 300n }),
  );
  assert.throws(
    () => assertCampaignBudget({ total: 1_000n, indexed: 400n, reserved: 300n, next: 301n }),
    /CAMPAIGN_BUDGET_EXCEEDED/,
  );
  assert.throws(
    () => assertCampaignBudget({ total: 1_000n, indexed: -1n, reserved: 0n, next: 1n }),
    /CAMPAIGN_BUDGET_INVALID/,
  );
});
