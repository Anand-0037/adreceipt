import {
  buildCampaign,
  INTENTS,
  parseCampaignInput,
  SENSITIVE_CLASSES,
  TOPICS,
  type CampaignInput,
  type CampaignRecord,
} from "../v2/campaign";
import type { PlacementMetrics } from "../v2/ticket";

/**
 * AdCP over MCP, on top of the existing AdReceipt V2 services.
 *
 * This module is an adapter and nothing else. It owns no campaign store, no
 * settlement path, no verifier and no metrics ledger: `create_media_buy` runs
 * the same `parseCampaignInput` the REST route runs, and delivery reads the
 * same Graph-plus-RPC verifier the ledger reads. That is deliberate - a second
 * implementation of any of those would eventually disagree with the first, and
 * the disagreement would be invisible until it mattered.
 *
 * Everything here is dependency-injected rather than importing the live store,
 * so the refusal paths can be tested without a database, an RPC endpoint or a
 * subgraph. `createDefaultDeps` in ./server.ts wires the real ones.
 *
 * Two honesty rules run through the whole file:
 *
 * 1. Nothing reports payment that has not been verified twice. `spend` comes
 *    only from receipts on which The Graph and Sepolia RPC agree. When that
 *    evidence cannot be gathered, delivery reports the failure and omits spend
 *    rather than falling back to a cached status.
 *
 * 2. Nothing claims more proof than exists. The Chainlink policy decision is
 *    `CRE_SIMULATED` here, and `get_adcp_capabilities` says so in the same
 *    breath as it advertises the tools.
 */

/** The AdCP revision these tool shapes were written against. */
export const ADCP_VERSION = "1.0";
export const ADCP_TOOLS = [
  "get_adcp_capabilities",
  "get_products",
  "create_media_buy",
  "get_media_buy_delivery",
] as const;

/** The single product AdReceipt can actually render today. */
export const PRODUCT_ID = "adreceipt-sponsored-recommendation";

export interface PlacementBindings {
  publisher: string;
  payer: string;
  recipient: string;
}

/**
 * Onchain delivery evidence.
 *
 * `UNAVAILABLE` is a first-class outcome, not an error to be smoothed over. If
 * the subgraph or the RPC endpoint cannot be reached, the honest answer is that
 * spend is unknown - reporting zero would read as "this campaign spent nothing"
 * and reporting a cached figure would report money as verified on evidence
 * nobody just checked.
 */
export interface OnchainDelivery {
  status: "VERIFIED" | "UNAVAILABLE";
  spendAtomic?: string;
  verifiedReceipts?: number;
  indexedBlock?: number;
  rpcHead?: number;
  reason?: string;
}

export interface AdcpStore {
  configured(): boolean;
  createCampaign(input: CampaignInput): Promise<CampaignRecord>;
  getCampaign(campaignId: string): Promise<CampaignRecord | null>;
  campaignMetrics(campaignId: string): Promise<PlacementMetrics>;
}

export interface AdcpDeps {
  store: AdcpStore;
  /** The shared Graph-plus-RPC verifier. Never a cached placement status. */
  verifiedDelivery(campaignId: string): Promise<OnchainDelivery>;
  bindings(): PlacementBindings | null;
  settlement: { chainId: number; network: string; address: string; asset: string };
  assetSymbol: string;
  assetDecimals: number;
  publisherDomain?: string;
  now?(): number;
}

const BYTES32 = /^0x[0-9a-f]{64}$/i;

export class AdcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function seconds(value: unknown, field: string): string {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return value;
  if (typeof value !== "string") throw new AdcpError("invalid-time", `${field} must be a string`);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new AdcpError("invalid-time", `${field} must be an ISO-8601 timestamp`);
  }
  return String(Math.floor(parsed / 1_000));
}

/**
 * Currency amount to atomic units, without floating point.
 *
 * `Number` would silently round a budget - 0.1 + 0.2 arithmetic on money is how
 * ledgers end up off by a unit - so the decimal string is split and padded.
 */
export function toAtomic(amount: unknown, decimals: number, field: string): string {
  const text = typeof amount === "number" ? String(amount) : amount;
  if (typeof text !== "string" || !/^\d+(\.\d+)?$/.test(text.trim())) {
    throw new AdcpError("invalid-budget", `${field} must be a positive decimal amount`);
  }
  const [whole, fraction = ""] = text.trim().split(".");
  if (fraction.length > decimals) {
    throw new AdcpError(
      "invalid-budget",
      `${field} has more than ${decimals} decimal places for this settlement asset`,
    );
  }
  const atomic = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (atomic <= 0n) throw new AdcpError("invalid-budget", `${field} must be greater than zero`);
  return atomic.toString();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdcpError("invalid-request", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

// ── get_adcp_capabilities ──────────────────────────────────────────────────

/**
 * What this seller supports, and - just as importantly - what it does not.
 *
 * An agent that discovers a seller has no way to tell a deliberate limitation
 * from a bug unless the seller says. The `not_supported` and
 * `conformance_notes` blocks are therefore part of the contract, not
 * documentation flavour: they are what stops an agent from assuming an auction,
 * a second product, or an enforced hardware proof exists here.
 */
export function getAdcpCapabilities(deps: AdcpDeps) {
  const bindings = deps.bindings();
  return {
    adcp_version: ADCP_VERSION,
    role: "seller",
    transports: ["mcp"],
    tools: [...ADCP_TOOLS],
    inventory_ready: Boolean(bindings) && deps.store.configured(),
    settlement: {
      chain: deps.settlement.network,
      chain_id: deps.settlement.chainId,
      settlement_contract: deps.settlement.address,
      asset: deps.settlement.asset,
      asset_symbol: deps.assetSymbol,
      asset_decimals: deps.assetDecimals,
      model: "per-placement flat rate, settled onchain against a publisher-signed quote",
    },
    proof: {
      // Stated first because everything downstream inherits it.
      policy_proof_level: "CRE_SIMULATED",
      meaning:
        "The confidential placement policy is evaluated by the Chainlink CRE workflow in simulation. Deployment access for a live DON is not enabled, so no placement here carries an enforced hardware attestation.",
      payment_verification:
        "The Graph plus Sepolia RPC must agree before any receipt reads PAID_VERIFIED.",
    },
    not_supported: [
      "auctions or real-time bidding",
      "more than one publisher product",
      "audience identity signals or personalization",
      "CPM or CPC batch settlement",
      "A2A transport",
      "creative generation tools",
      "public catalog registration",
      "update_media_buy, sync_creatives, and the remaining AdCP media-buy tasks",
    ],
    conformance_notes: [
      "create_media_buy always returns input-required: a campaign is a draft until the advertiser wallet signs its exact revision. No tool call can activate a campaign.",
      "Publisher identity is a wallet address, so publisher_properties carries a wallet identifier rather than a verified domain.",
      "Delivery is lifetime-to-date. Impressions and clicks are application-observed; only spend is onchain evidence.",
      "AdReceipt-specific campaign fields are carried under ext.adreceipt because AdCP does not model them.",
    ],
    privacy_boundary: {
      never_disclosed: [
        "raw user queries",
        "user identity or memories",
        "precise location",
        "commitment salts",
        "the private campaign policy, its product allowlist and its bid ceiling",
      ],
      // These are the states in which no placement exists at all, which is a
      // stronger guarantee than a placement that merely goes unbilled.
      fails_closed_on: [
        "unknown or under-18 age eligibility",
        "any sensitive context class",
        "unclassified intent or no topic match",
      ],
    },
  };
}

// ── get_products ───────────────────────────────────────────────────────────

function product(deps: AdcpDeps, bindings: PlacementBindings) {
  return {
    product_id: PRODUCT_ID,
    name: "Sponsored recommendation in an AI answer",
    description:
      "A single disclosed sponsored recommendation rendered beneath an independently generated AI answer, shown only when the sanitized context matches the campaign. Payment settles onchain against a publisher-signed quote bound to the exact rendered text.",
    publisher_properties: [
      {
        property_type: "website",
        name: "AdReceipt sponsored answer surface",
        identifiers: [{ type: "publisher_wallet", value: bindings.publisher }],
        ...(deps.publisherDomain ? { publisher_domain: deps.publisherDomain } : {}),
      },
    ],
    // Not guaranteed: a placement exists only if a real query produces a
    // matching sanitized context. No volume can be promised in advance.
    delivery_type: "non_guaranteed",
    sponsored_placement_types: ["sponsored_native"],
    is_custom: false,
    pricing_options: [
      {
        pricing_model: "flat_rate",
        currency: deps.assetSymbol,
        // The publisher sets the per-placement price when it signs the quote;
        // the campaign's max_placement_amount is the ceiling the confidential
        // policy enforces.
        rate_basis: "per_placement",
        settlement_asset: deps.settlement.asset,
        asset_decimals: deps.assetDecimals,
      },
    ],
    reporting_capabilities: {
      available_reporting_frequencies: ["on_demand"],
      expected_delay_minutes: 0,
      timezone: "UTC",
      supports_webhooks: false,
      available_metrics: ["impressions", "clicks", "spend"],
      date_range_support: "lifetime_only",
      supports_creative_breakdown: false,
      supports_format_breakdown: false,
      supports_keyword_breakdown: false,
      supports_audience_breakdown: false,
      supports_placement_breakdown: false,
      supports_property_breakdown: false,
    },
    creative_policy: {
      // The rendered text is hashed into the placement ticket, so a creative
      // cannot be swapped after the publisher signs.
      co_branding: "required",
      landing_page: "https_only",
      content_binding: "The exact rendered headline and body are hashed into the placement ticket.",
      max_headline_characters: 120,
      max_body_characters: 300,
    },
    ext: {
      adreceipt: {
        targeting_dimensions: {
          topics: [...TOPICS],
          intents: [...INTENTS],
          blockable_context_classes: [...SENSITIVE_CLASSES],
          personalization: false,
        },
        metric_provenance: {
          impressions: "application-observed",
          clicks: "application-observed",
          spend: "onchain, verified by The Graph and Sepolia RPC",
        },
        policy_proof_level: "CRE_SIMULATED",
      },
    },
  };
}

/**
 * Real, renderable inventory only.
 *
 * When the publisher, payer and recipient bindings are missing, or campaign
 * storage is down, nothing can actually be rendered or paid for - so the honest
 * response is an empty catalogue with a reason. Advertising a product that
 * cannot be delivered is worse than advertising none.
 */
export function getProducts(deps: AdcpDeps, request: unknown = {}) {
  const input = record(request ?? {}, "request");
  const bindings = deps.bindings();

  if (!bindings || !deps.store.configured()) {
    return {
      products: [],
      reason: !bindings
        ? "Publisher, payer and recipient bindings are not configured, so no placement can be rendered or settled."
        : "Campaign storage is unavailable, so no campaign can be created against this inventory.",
      sandbox: false,
    };
  }

  const brief = typeof input.brief === "string" ? input.brief.trim() : "";
  return {
    products: [product(deps, bindings)],
    ...(brief ? { brief_acknowledged: true } : {}),
    sandbox: false,
  };
}

// ── create_media_buy ───────────────────────────────────────────────────────

export interface MediaBuyDraft {
  status: "input-required";
  task_id: string;
  media_buy_id: string;
  buyer_ref?: string;
  /** Explicit, because an agent must not read a draft as a live buy. */
  activation: {
    state: "AWAITING_ADVERTISER_SIGNATURE";
    message: string;
    required_signer: string;
    sign: { domain: unknown; primaryType: string; types: unknown; message: unknown };
    campaign_revision_hash: string;
    submit_signature_to: string;
  };
  campaign: CampaignRecord["manifest"];
  packages: { package_id: string; product_id: string; status: string }[];
  ext: { adreceipt: Record<string, unknown> };
}

/**
 * Map an AdCP media buy onto an AdReceipt campaign draft.
 *
 * The mapping deliberately funnels into `parseCampaignInput`, the same function
 * the REST route calls. Validation, normalisation and the resulting
 * `campaignRevisionHash` are therefore identical for identical canonical data,
 * which is what lets an agent and the web app cooperate on one campaign instead
 * of two that merely look alike.
 */
export function toCampaignInput(deps: AdcpDeps, request: unknown): CampaignInput {
  const input = record(request, "request");
  const ext = record(record(input.ext ?? {}, "ext").adreceipt ?? {}, "ext.adreceipt");
  const brand = record(input.brand ?? {}, "brand");

  if (typeof input.idempotency_key !== "string" || !input.idempotency_key.trim()) {
    throw new AdcpError("invalid-request", "idempotency_key is required");
  }

  const packages = Array.isArray(input.packages) ? input.packages : [];
  if (packages.length !== 1) {
    throw new AdcpError(
      "unsupported-packages",
      "Exactly one package is supported, and it must reference the single AdReceipt product.",
    );
  }
  const pkg = record(packages[0], "packages[0]");
  const productIds = Array.isArray(pkg.products) ? pkg.products.map(String) : [];
  if (!productIds.includes(PRODUCT_ID)) {
    throw new AdcpError(
      "unknown-product",
      `packages[0].products must reference ${PRODUCT_ID}. Call get_products first.`,
    );
  }

  const budget = record(input.total_budget ?? {}, "total_budget");
  if (typeof budget.currency === "string" && budget.currency.toUpperCase() !== deps.assetSymbol) {
    throw new AdcpError(
      "unsupported-currency",
      `This seller settles only in ${deps.assetSymbol} on ${deps.settlement.network}.`,
    );
  }

  const totalBudget =
    typeof ext.total_budget_atomic === "string"
      ? ext.total_budget_atomic
      : toAtomic(budget.amount, deps.assetDecimals, "total_budget.amount");
  const maxPlacementAmount =
    typeof ext.max_placement_amount_atomic === "string"
      ? ext.max_placement_amount_atomic
      : toAtomic(
          ext.max_placement_amount,
          deps.assetDecimals,
          "ext.adreceipt.max_placement_amount",
        );

  const creative = record(ext.creative ?? {}, "ext.adreceipt.creative");
  const targeting = record(ext.targeting ?? {}, "ext.adreceipt.targeting");

  // Hand the REST parser exactly the body it expects; every error message,
  // bound and normalisation below this line is the REST implementation's.
  return parseCampaignInput({
    advertiserWallet: ext.advertiser_wallet,
    brandDisplayName: brand.name ?? ext.brand_display_name,
    productRef: ext.product_ref,
    landingPage: ext.landing_page ?? brand.url,
    objective: "WEBSITE_VISIT",
    settlementAsset: deps.settlement.asset,
    totalBudget,
    maxPlacementAmount,
    targetTopics: targeting.topics,
    targetIntents: targeting.intents,
    allowedLocales: targeting.locales,
    blockedContextClasses: targeting.blocked_context_classes,
    creativeHeadline: creative.headline,
    creativeBody: creative.body,
    validFrom: seconds(input.start_time, "start_time"),
    validUntil: seconds(input.end_time, "end_time"),
  });
}

export async function createMediaBuy(deps: AdcpDeps, request: unknown): Promise<MediaBuyDraft> {
  const input = record(request, "request");
  const bindings = deps.bindings();
  if (!bindings || !deps.store.configured()) {
    throw new AdcpError(
      "inventory-unavailable",
      "This seller cannot accept a media buy right now. Call get_adcp_capabilities for the reason.",
    );
  }

  const campaignInput = toCampaignInput(deps, request);
  const created = await deps.store.createCampaign(campaignInput);

  if (created.manifest.status !== "DRAFT") {
    // The store is the authority on status; if it ever returns anything else
    // for a new campaign, refuse rather than report an unsigned buy as live.
    throw new AdcpError(
      "unexpected-campaign-state",
      "A newly created campaign must be a draft. Refusing to report it as bought.",
    );
  }

  return {
    status: "input-required",
    task_id: `adreceipt-approval-${created.manifest.campaignId}-${created.manifest.revision}`,
    media_buy_id: created.manifest.campaignId,
    ...(typeof input.buyer_ref === "string" ? { buyer_ref: input.buyer_ref } : {}),
    activation: {
      state: "AWAITING_ADVERTISER_SIGNATURE",
      message:
        "This campaign is a draft and will not serve. The advertiser wallet must sign this exact revision before it can be activated. No agent call can activate it.",
      required_signer: created.manifest.advertiserWallet,
      sign: {
        domain: created.typedData.domain,
        primaryType: created.typedData.primaryType,
        types: { CampaignManifestV2: created.typedData.types },
        message: created.typedData.message,
      },
      campaign_revision_hash: created.manifest.campaignRevisionHash,
      submit_signature_to: `POST /v2/campaigns/${created.manifest.campaignId}/revisions/${created.manifest.revision}/approve`,
    },
    campaign: created.manifest,
    packages: [
      {
        package_id: `${created.manifest.campaignId}-1`,
        product_id: PRODUCT_ID,
        status: "draft",
      },
    ],
    ext: {
      adreceipt: {
        policy_proof_level: "CRE_SIMULATED",
        settlement_contract: deps.settlement.address,
        chain_id: deps.settlement.chainId,
        note: "Placements are authorized per query by the confidential policy; this buy reserves no inventory.",
      },
    },
  };
}

// ── get_media_buy_delivery ─────────────────────────────────────────────────

/**
 * Delivery, with the provenance of every number attached.
 *
 * Impressions and clicks are counted by the application when it renders and
 * when someone follows the link. Nobody should mistake them for settled money,
 * so they are labelled at the point of use and `spend` is sourced separately -
 * from receipts two independent systems agree on. When that agreement cannot be
 * obtained the row reports `reporting_delayed` and omits spend entirely.
 */
export async function getMediaBuyDelivery(deps: AdcpDeps, request: unknown) {
  const input = record(request ?? {}, "request");
  const ids = Array.isArray(input.media_buy_ids) ? input.media_buy_ids.map(String) : [];
  if (ids.length === 0) {
    throw new AdcpError("invalid-request", "media_buy_ids must contain at least one campaign id");
  }
  if (ids.length > 25) {
    throw new AdcpError("invalid-request", "At most 25 media_buy_ids may be requested at once");
  }

  const now = deps.now?.() ?? Math.floor(Date.now() / 1_000);
  const deliveries = [];
  const errors: { media_buy_id: string; code: string; message: string }[] = [];

  for (const id of ids) {
    if (!BYTES32.test(id)) {
      errors.push({
        media_buy_id: id,
        code: "invalid-media-buy-id",
        message: "media_buy_id must be a bytes32 campaign id",
      });
      continue;
    }

    const campaign = await deps.store.getCampaign(id).catch(() => null);
    if (!campaign) {
      errors.push({ media_buy_id: id, code: "not-found", message: "Campaign not found." });
      continue;
    }

    const [metrics, onchain] = await Promise.all([
      deps.store.campaignMetrics(id).catch(() => null),
      deps.verifiedDelivery(id),
    ]);

    const verified = onchain.status === "VERIFIED";
    if (!verified) {
      errors.push({
        media_buy_id: id,
        code: "payment-evidence-unavailable",
        message:
          onchain.reason ??
          "The Graph and Sepolia RPC could not both be consulted, so spend is unknown.",
      });
    }

    deliveries.push({
      media_buy_id: id,
      status: deliveryStatus(campaign, verified, now),
      currency: deps.assetSymbol,
      pricing_model: "flat_rate",
      is_final: false,
      totals: {
        // Application-observed. See metric_provenance below.
        impressions: metrics?.impressions ?? 0,
        clicks: metrics?.clicks ?? 0,
        // Spend appears only when two independent sources agree on it.
        ...(verified
          ? {
              spend: fromAtomic(onchain.spendAtomic ?? "0", deps.assetDecimals),
              spend_atomic: onchain.spendAtomic ?? "0",
            }
          : {}),
      },
      by_package: [
        {
          package_id: `${id}-1`,
          product_id: PRODUCT_ID,
          impressions: metrics?.impressions ?? 0,
          clicks: metrics?.clicks ?? 0,
        },
      ],
      ext: {
        adreceipt: {
          metric_provenance: {
            impressions: "application-observed",
            clicks: "application-observed",
            spend: verified
              ? "onchain, verified by The Graph and Sepolia RPC"
              : "unavailable - not reported",
          },
          onchain_evidence: onchain,
          campaign_status: campaign.manifest.status,
          policy_proof_level: "CRE_SIMULATED",
        },
      },
    });
  }

  return {
    reporting_period: { start: null, end: new Date(now * 1_000).toISOString(), basis: "lifetime" },
    currency: deps.assetSymbol,
    media_buy_deliveries: deliveries,
    partial_data: errors.length > 0,
    ...(errors.length > 0 ? { errors } : {}),
    sandbox: false,
  };
}

/**
 * An AdCP delivery status that never overstates the buy.
 *
 * A campaign nobody has signed is `pending_creatives`, not `active`, and one
 * whose payment evidence could not be read is `reporting_delayed` - both are
 * AdCP-defined states that say "not confirmed" rather than implying delivery.
 */
function deliveryStatus(campaign: CampaignRecord, verified: boolean, now: number): string {
  if (!verified) return "reporting_delayed";
  const manifest = campaign.manifest;
  if (manifest.status === "DRAFT") return "pending_creatives";
  if (manifest.status === "PAUSED") return "paused";
  if (BigInt(manifest.validUntil) <= BigInt(now)) return "completed";
  if (BigInt(manifest.validFrom) > BigInt(now)) return "pending_start";
  return "active";
}

/** Atomic units back to a decimal string, again without floating point. */
export function fromAtomic(atomic: string, decimals: number): string {
  const value = BigInt(atomic);
  if (decimals === 0) return value.toString();
  const text = value.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Exported for the cross-path commitment test. */
export function campaignFromAdcp(deps: AdcpDeps, request: unknown, campaignId: string) {
  return buildCampaign(toCampaignInput(deps, request), campaignId, 1);
}
