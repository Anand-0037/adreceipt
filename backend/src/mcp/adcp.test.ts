import assert from "node:assert/strict";
import test from "node:test";
import { TypedDataEncoder, Wallet } from "ethers";
import {
  ADCP_TOOLS,
  AdcpError,
  campaignFromAdcp,
  createMediaBuy,
  fromAtomic,
  getAdcpCapabilities,
  getMediaBuyDelivery,
  getProducts,
  PRODUCT_ID,
  toAtomic,
  toCampaignInput,
  type AdcpDeps,
  type OnchainDelivery,
  type PlacementBindings,
} from "./adcp";
import { buildCampaign, decideCampaign, parseCampaignInput } from "../v2/campaign";
import type { CampaignInput, CampaignRecord } from "../v2/campaign";
import type { PlacementMetrics } from "../v2/ticket";

/**
 * The adapter's job is to refuse well.
 *
 * Every test below is either "does it map onto the existing services exactly"
 * or "does it decline to report something it cannot prove". Those are the two
 * ways an advertising adapter does real damage: by inventing a second campaign
 * representation that drifts from the first, or by reporting money as settled
 * on evidence nobody checked.
 */

const ADVERTISER = "0x84B5711b5Ff458478A2E55bb4797F5b254517a57";
const SETTLEMENT = {
  chainId: 11155111,
  network: "sepolia",
  address: "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576",
  asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

const BINDINGS: PlacementBindings = {
  publisher: "0x9999999999999999999999999999999999999999",
  payer: ADVERTISER,
  recipient: "0x5555555555555555555555555555555555555555",
};

function adcpRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotency_key: "buy-1",
    brand: { name: "DeployCo", url: "https://deployco.example/pricing" },
    start_time: "2026-01-01T00:00:00Z",
    end_time: "2026-02-01T00:00:00Z",
    total_budget: { amount: "25.00", currency: "USDC" },
    packages: [{ products: [PRODUCT_ID] }],
    ext: {
      adreceipt: {
        advertiser_wallet: ADVERTISER,
        product_ref: "DeployCo managed Postgres",
        max_placement_amount: "0.5",
        creative: {
          headline: "DeployCo managed Postgres",
          body: "Managed Postgres with daily backups and a free tier for side projects.",
        },
        targeting: {
          topics: ["DEVELOPER_TOOLS", "CLOUD_INFRASTRUCTURE"],
          intents: ["COMPARE_OPTIONS"],
          locales: ["en"],
          blocked_context_classes: ["HEALTH", "POLITICS"],
        },
      },
    },
    ...overrides,
  };
}

interface StubOptions {
  configured?: boolean;
  bindings?: PlacementBindings | null;
  campaign?: CampaignRecord | null;
  metrics?: Partial<PlacementMetrics>;
  onchain?: OnchainDelivery;
  createdStatus?: CampaignRecord["manifest"]["status"];
}

function deps(options: StubOptions = {}): AdcpDeps & { created: CampaignInput[] } {
  const created: CampaignInput[] = [];
  return {
    created,
    store: {
      configured: () => options.configured ?? true,
      async createCampaign(input) {
        created.push(input);
        const record = buildCampaign(input, `0x${"a1".repeat(32)}`, 1);
        return options.createdStatus
          ? { ...record, manifest: { ...record.manifest, status: options.createdStatus } }
          : record;
      },
      async getCampaign() {
        return options.campaign ?? null;
      },
      async campaignMetrics(campaignId) {
        return {
          campaignId,
          verifiedPlacements: 0,
          spendAtomic: "0",
          impressions: 0,
          clicks: 0,
          ctrPercent: null,
          effectiveCpcAtomic: null,
          effectiveCpmAtomic: null,
          ...options.metrics,
        };
      },
    },
    async verifiedDelivery() {
      return options.onchain ?? { status: "VERIFIED", spendAtomic: "0", verifiedReceipts: 0 };
    },
    bindings: () => (options.bindings === undefined ? BINDINGS : options.bindings),
    settlement: SETTLEMENT,
    assetSymbol: "USDC",
    assetDecimals: 6,
    now: () => 1_767_312_000,
  };
}

function campaignRecord(): CampaignRecord {
  return buildCampaign(toCampaignInput(deps(), adcpRequest()), `0x${"a1".repeat(32)}`, 1);
}

// ── discovery ──────────────────────────────────────────────────────────────

test("capabilities advertise the four tools and state the boundary", () => {
  const capabilities = getAdcpCapabilities(deps());

  assert.deepEqual(capabilities.tools, [...ADCP_TOOLS]);
  assert.equal(capabilities.role, "seller");
  // The proof claim must never quietly become CRE_ENFORCED here.
  assert.equal(capabilities.proof.policy_proof_level, "CRE_SIMULATED");
  assert.match(capabilities.proof.payment_verification, /Graph.*RPC/i);
  assert.ok(capabilities.not_supported.some((item) => /auction/i.test(item)));
  assert.ok(capabilities.conformance_notes.some((note) => /input-required/i.test(note)));
  assert.ok(capabilities.privacy_boundary.never_disclosed.includes("raw user queries"));
  assert.ok(capabilities.privacy_boundary.never_disclosed.includes("commitment salts"));
});

test("get_products returns the one renderable product", () => {
  const result = getProducts(deps(), { brief: "developer tooling" });

  assert.equal(result.products.length, 1);
  const [product] = result.products;
  assert.equal(product.product_id, PRODUCT_ID);
  assert.equal(product.delivery_type, "non_guaranteed");
  assert.deepEqual(product.sponsored_placement_types, ["sponsored_native"]);
  assert.equal(product.pricing_options[0].pricing_model, "flat_rate");
  assert.equal(product.publisher_properties[0].identifiers[0].value, BINDINGS.publisher);
  // Every required AdCP product field is present.
  for (const field of [
    "product_id",
    "name",
    "description",
    "publisher_properties",
    "delivery_type",
    "pricing_options",
    "reporting_capabilities",
  ]) {
    assert.ok(field in product, `product is missing ${field}`);
  }
});

test("get_products advertises nothing it cannot render", () => {
  // No bindings means no publisher to sign and no recipient to pay.
  const unbound = getProducts(deps({ bindings: null }), {});
  assert.deepEqual(unbound.products, []);
  assert.match(unbound.reason ?? "", /bindings are not configured/i);

  const unstored = getProducts(deps({ configured: false }), {});
  assert.deepEqual(unstored.products, []);
  assert.match(unstored.reason ?? "", /storage is unavailable/i);
});

test("the product declares metric provenance rather than implying it", () => {
  const [product] = getProducts(deps(), {}).products;
  const provenance = product.ext.adreceipt.metric_provenance;
  assert.equal(provenance.impressions, "application-observed");
  assert.equal(provenance.clicks, "application-observed");
  assert.match(provenance.spend, /onchain/i);
});

// ── create_media_buy ───────────────────────────────────────────────────────

test("create_media_buy produces a draft that pauses for the advertiser signature", async () => {
  const dependencies = deps();
  const draft = await createMediaBuy(dependencies, adcpRequest());

  assert.equal(draft.status, "input-required");
  assert.equal(draft.activation.state, "AWAITING_ADVERTISER_SIGNATURE");
  assert.equal(draft.campaign.status, "DRAFT");
  assert.equal(draft.activation.required_signer, ADVERTISER);
  assert.equal(draft.activation.campaign_revision_hash, draft.campaign.campaignRevisionHash);
  assert.match(draft.activation.submit_signature_to, /\/approve$/);
  assert.equal(draft.packages[0].product_id, PRODUCT_ID);
  assert.equal(dependencies.created.length, 1);
});

test("the returned typed data is what actually approves the campaign", async () => {
  // A draft is useless if the payload it hands back does not recover to the
  // advertiser through the same check the REST approval route runs.
  const wallet = Wallet.createRandom();
  const request = adcpRequest();
  (request.ext as Record<string, Record<string, unknown>>).adreceipt.advertiser_wallet =
    wallet.address;

  const draft = await createMediaBuy(deps(), request);
  const { domain, types, message } = draft.activation.sign as {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
  };
  const signature = await wallet.signTypedData(domain as never, types as never, message);

  assert.equal(
    TypedDataEncoder.hashStruct("CampaignManifestV2", types as never, message),
    draft.campaign.campaignRevisionHash,
  );
  assert.equal(
    (await import("ethers")).verifyTypedData(domain as never, types as never, message, signature),
    wallet.address,
  );
});

test("REST and MCP derive the same campaign revision hash for the same data", async () => {
  // The acceptance criterion that matters most: one campaign representation.
  const dependencies = deps();
  const mapped = toCampaignInput(dependencies, adcpRequest());

  const restBody = {
    advertiserWallet: ADVERTISER,
    brandDisplayName: "DeployCo",
    productRef: "DeployCo managed Postgres",
    landingPage: "https://deployco.example/pricing",
    objective: "WEBSITE_VISIT",
    settlementAsset: SETTLEMENT.asset,
    totalBudget: "25000000",
    maxPlacementAmount: "500000",
    targetTopics: ["DEVELOPER_TOOLS", "CLOUD_INFRASTRUCTURE"],
    targetIntents: ["COMPARE_OPTIONS"],
    allowedLocales: ["en"],
    blockedContextClasses: ["HEALTH", "POLITICS"],
    creativeHeadline: "DeployCo managed Postgres",
    creativeBody: "Managed Postgres with daily backups and a free tier for side projects.",
    validFrom: "1767225600",
    validUntil: "1769904000",
  };
  const viaRest = parseCampaignInput(restBody);

  assert.deepEqual(mapped, viaRest, "MCP and REST must normalise to the same CampaignInput");

  const id = `0x${"a1".repeat(32)}`;
  assert.equal(
    campaignFromAdcp(dependencies, adcpRequest(), id).manifest.campaignRevisionHash,
    buildCampaign(restBody, id, 1).manifest.campaignRevisionHash,
  );
});

test("the same canonical data produces the same placement ticket commitment", async () => {
  // campaignRevisionHash is an input to PlacementTicketV2, so equality above
  // has to survive all the way into the commitment the chain sees.
  const id = `0x${"a1".repeat(32)}`;
  const viaAdcp = campaignFromAdcp(deps(), adcpRequest(), id).manifest;
  const viaRest = buildCampaign(toCampaignInput(deps(), adcpRequest()), id, 1).manifest;

  const TICKET_TYPES = {
    PlacementTicketV2: [
      { name: "schemaVersion", type: "uint16" },
      { name: "campaignRevisionHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
  };
  const commitment = (revisionHash: string) =>
    TypedDataEncoder.hashStruct("PlacementTicketV2", TICKET_TYPES as never, {
      schemaVersion: 2,
      campaignRevisionHash: revisionHash,
      amount: 500000n,
    });

  assert.equal(commitment(viaAdcp.campaignRevisionHash), commitment(viaRest.campaignRevisionHash));
});

test("create_media_buy refuses when nothing could be delivered", async () => {
  await assert.rejects(
    () => createMediaBuy(deps({ bindings: null }), adcpRequest()),
    /cannot accept a media buy/i,
  );
  await assert.rejects(
    () => createMediaBuy(deps({ configured: false }), adcpRequest()),
    /cannot accept a media buy/i,
  );
});

test("create_media_buy refuses to report a non-draft as bought", async () => {
  // If the store ever hands back an ACTIVE campaign, that is a bug - and
  // reporting it as a completed buy would hide an unapproved live campaign.
  await assert.rejects(
    () => createMediaBuy(deps({ createdStatus: "ACTIVE" }), adcpRequest()),
    /must be a draft/i,
  );
});

test("create_media_buy rejects malformed and unsupported requests", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ packages: [] }, /Exactly one package/i],
    [{ packages: [{ products: ["someone-elses-product"] }] }, /must reference/i],
    [{ idempotency_key: "" }, /idempotency_key is required/i],
    [{ total_budget: { amount: "25.00", currency: "EUR" } }, /settles only in USDC/i],
    [{ start_time: "not-a-date" }, /ISO-8601/i],
    [{ total_budget: { amount: "0", currency: "USDC" } }, /greater than zero/i],
    [{ total_budget: { amount: "1.1234567", currency: "USDC" } }, /decimal places/i],
  ];

  for (const [overrides, expected] of cases) {
    await assert.rejects(
      () => createMediaBuy(deps(), adcpRequest(overrides)),
      expected,
      `expected ${expected} for ${JSON.stringify(overrides)}`,
    );
  }
});

test("campaign validation stays the REST implementation's, not a second copy", async () => {
  const request = adcpRequest();
  const ext = (request.ext as Record<string, Record<string, unknown>>).adreceipt;

  // An http landing page is refused by parseCampaignInput, and the adapter
  // must surface that rather than quietly normalising it.
  ext.landing_page = "http://deployco.example/pricing";
  await assert.rejects(() => createMediaBuy(deps(), request), /https/i);

  ext.landing_page = "https://deployco.example/pricing";
  (ext.targeting as Record<string, unknown>).topics = ["NOT_A_TOPIC"];
  await assert.rejects(() => createMediaBuy(deps(), request), /targetTopics contains NOT_A_TOPIC/i);
});

// ── get_media_buy_delivery ─────────────────────────────────────────────────

const CAMPAIGN_ID = `0x${"a1".repeat(32)}`;

test("delivery reports verified spend separately from observed engagement", async () => {
  const result = await getMediaBuyDelivery(
    deps({
      campaign: campaignRecord(),
      metrics: { impressions: 40, clicks: 5 },
      onchain: {
        status: "VERIFIED",
        spendAtomic: "1500000",
        verifiedReceipts: 3,
        indexedBlock: 11_656_871,
        rpcHead: 11_656_880,
      },
    }),
    { media_buy_ids: [CAMPAIGN_ID] },
  );

  assert.equal(result.media_buy_deliveries.length, 1);
  const [delivery] = result.media_buy_deliveries;
  assert.equal(delivery.totals.impressions, 40);
  assert.equal(delivery.totals.clicks, 5);
  assert.equal(delivery.totals.spend, "1.5");
  assert.equal(delivery.totals.spend_atomic, "1500000");
  assert.equal(delivery.ext.adreceipt.metric_provenance.impressions, "application-observed");
  assert.match(delivery.ext.adreceipt.metric_provenance.spend, /Graph and Sepolia RPC/);
  assert.equal(result.partial_data, false);
});

test("unverified payment is never reported as spend", async () => {
  // The core refusal: impressions exist, money is unproven, so no spend field
  // appears at all and the row says so.
  const result = await getMediaBuyDelivery(
    deps({
      campaign: campaignRecord(),
      metrics: { impressions: 40, clicks: 5 },
      onchain: { status: "UNAVAILABLE", reason: "Subgraph unreachable" },
    }),
    { media_buy_ids: [CAMPAIGN_ID] },
  );

  const [delivery] = result.media_buy_deliveries;
  assert.equal(delivery.status, "reporting_delayed");
  assert.equal("spend" in delivery.totals, false);
  assert.equal("spend_atomic" in delivery.totals, false);
  assert.equal(delivery.totals.impressions, 40);
  assert.equal(delivery.ext.adreceipt.metric_provenance.spend, "unavailable - not reported");
  assert.equal(result.partial_data, true);
  assert.equal(result.errors?.[0].code, "payment-evidence-unavailable");
});

test("an unsigned campaign never reads as active", async () => {
  const draft = campaignRecord();
  const result = await getMediaBuyDelivery(
    deps({ campaign: { ...draft, manifest: { ...draft.manifest, status: "DRAFT" } } }),
    { media_buy_ids: [CAMPAIGN_ID] },
  );
  assert.equal(result.media_buy_deliveries[0].status, "pending_creatives");
});

test("delivery rejects malformed identifiers without failing the whole call", async () => {
  const result = await getMediaBuyDelivery(deps({ campaign: campaignRecord() }), {
    media_buy_ids: ["not-bytes32", CAMPAIGN_ID],
  });

  assert.equal(result.media_buy_deliveries.length, 1);
  assert.equal(result.errors?.[0].code, "invalid-media-buy-id");
  assert.equal(result.partial_data, true);
});

test("delivery reports an unknown campaign as not found", async () => {
  const result = await getMediaBuyDelivery(deps({ campaign: null }), {
    media_buy_ids: [CAMPAIGN_ID],
  });
  assert.deepEqual(result.media_buy_deliveries, []);
  assert.equal(result.errors?.[0].code, "not-found");
});

test("delivery refuses an empty or oversized batch", async () => {
  await assert.rejects(
    () => getMediaBuyDelivery(deps(), { media_buy_ids: [] }),
    /at least one campaign id/i,
  );
  await assert.rejects(
    () => getMediaBuyDelivery(deps(), { media_buy_ids: Array(26).fill(CAMPAIGN_ID) }),
    /At most 25/i,
  );
});

// ── privacy and fail-closed behaviour ──────────────────────────────────────

test("no adapter response carries a raw query or a salt", async () => {
  // A sentinel rather than a realistic sentence: advertiser copy is allowed to
  // contain ordinary English, so a phrase like "side project" would collide
  // with the creative body and fail for the wrong reason.
  const RAW_QUERY_SENTINEL = "zzq-raw-user-words-must-never-leave-zzq";
  const decision = decideCampaign({
    decisionId: "11111111-1111-4111-8111-111111111111",
    query: `which managed postgres database tool ${RAW_QUERY_SENTINEL}`,
    ageEligibility: "ADULT_DECLARED",
    campaigns: [],
  });

  const payload = JSON.stringify({
    capabilities: getAdcpCapabilities(deps()),
    products: getProducts(deps(), { brief: "developer tooling" }),
    draft: await createMediaBuy(deps(), adcpRequest()),
    delivery: await getMediaBuyDelivery(deps({ campaign: campaignRecord() }), {
      media_buy_ids: [CAMPAIGN_ID],
    }),
  });

  assert.equal(
    payload.includes(RAW_QUERY_SENTINEL),
    false,
    "a raw query reached an agent response",
  );
  assert.equal(payload.includes(decision.privateSalt), false, "a commitment salt was disclosed");
  assert.equal(/"privateSalt"/.test(payload), false);
});

test("the decision layer this adapter depends on still fails closed", async () => {
  // The adapter never bypasses decideCampaign, so these refusals are what stop
  // a sensitive or underage context from ever producing a billable placement.
  const campaigns = [campaignRecord()];
  for (const [args, reason] of [
    [{ query: "best postgres host", ageEligibility: "UNKNOWN" }, "AGE_NOT_ELIGIBLE"],
    [{ query: "best postgres host", ageEligibility: "UNDER_18" }, "AGE_NOT_ELIGIBLE"],
    [
      { query: "I feel depressed, which therapy app is best", ageEligibility: "ADULT_DECLARED" },
      "SENSITIVE_CONTEXT",
    ],
    [{ query: "hello there", ageEligibility: "ADULT_DECLARED" }, "CONTEXT_UNCLASSIFIED"],
  ] as const) {
    const decision = decideCampaign({
      decisionId: "11111111-1111-4111-8111-111111111111",
      campaigns,
      ...args,
    });
    assert.equal(decision.status, "SUPPRESSED", `${args.query} should be suppressed`);
    assert.equal(decision.reasonCode, reason);
    assert.equal(decision.winner, undefined);
  }
});

// ── unit helpers ───────────────────────────────────────────────────────────

test("currency conversion never goes through floating point", () => {
  assert.equal(toAtomic("25.00", 6, "budget"), "25000000");
  assert.equal(toAtomic("0.1", 6, "budget"), "100000");
  assert.equal(toAtomic(0.3, 6, "budget"), "300000");
  assert.equal(fromAtomic("1500000", 6), "1.5");
  assert.equal(fromAtomic("1000000", 6), "1");
  assert.equal(fromAtomic("1", 6), "0.000001");
  assert.equal(fromAtomic("0", 6), "0");
  assert.throws(() => toAtomic("-1", 6, "budget"), AdcpError);
  assert.throws(() => toAtomic("abc", 6, "budget"), AdcpError);
});
