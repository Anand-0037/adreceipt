import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAddress, isAddress } from "ethers";
import { config, settlementDeployment } from "../config";
import { queryReceiptsByCampaign } from "../receipts/by-payer";
import { verifyReceiptCollection } from "../receipts/ledger";
import { v2Store } from "../v2/routes";
import {
  ADCP_VERSION,
  AdcpError,
  createMediaBuy,
  getAdcpCapabilities,
  getMediaBuyDelivery,
  getProducts,
  type AdcpDeps,
  type OnchainDelivery,
  type PlacementBindings,
} from "./adcp";

/**
 * The MCP surface for AdReceipt's AdCP adapter.
 *
 * Four tools, wired to the services the REST application already uses. The
 * server is built from an injected `AdcpDeps` so the transports below and the
 * tests share one code path; only `createDefaultDeps` reaches for the live
 * store, the live subgraph and the live RPC endpoint.
 */

/**
 * Live payment evidence for one campaign.
 *
 * This is the ledger's verifier, not a copy of it: the same Graph query and the
 * same `verifyReceiptCollection` the web ledger runs. `verifyReceiptCollection`
 * throws unless every row is `PAID_VERIFIED` against Sepolia, so a thrown error
 * here means "we could not establish payment", never "there was none" - and the
 * caller reports it as unavailable rather than as zero.
 */
async function liveVerifiedDelivery(campaignId: string): Promise<OnchainDelivery> {
  if (!config.graphQueryUrl) {
    return { status: "UNAVAILABLE", reason: "No subgraph endpoint is configured." };
  }
  try {
    const graph = await queryReceiptsByCampaign(
      config.graphQueryUrl,
      config.graphApiKey,
      campaignId,
    );
    const verified = await verifyReceiptCollection(graph, 100);
    if (verified.hasMore) {
      return {
        status: "UNAVAILABLE",
        reason:
          "This campaign has more receipts than one verification page. Refusing to report a partial total as settled spend.",
      };
    }
    return {
      status: "VERIFIED",
      spendAtomic: verified.receipts
        .reduce((total, receipt) => total + BigInt(receipt.amount), 0n)
        .toString(),
      verifiedReceipts: verified.count,
      indexedBlock: verified.indexedBlock,
      rpcHead: verified.rpcHead,
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      reason: `Graph and RPC evidence could not be agreed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function configuredAddress(value: string): string | null {
  if (!isAddress(value)) return null;
  const normalized = getAddress(value);
  return normalized === "0x0000000000000000000000000000000000000000" ? null : normalized;
}

/** The same binding rule the V2 routes apply, including payer !== recipient. */
export function liveBindings(): PlacementBindings | null {
  const publisher = configuredAddress(config.v2PublisherAddress);
  const payer = configuredAddress(config.v2PayerAddress);
  const recipient = configuredAddress(config.v2RecipientAddress);
  if (!publisher || !payer || !recipient) return null;
  if (payer.toLowerCase() === recipient.toLowerCase()) return null;
  return { publisher, payer, recipient };
}

export function createDefaultDeps(): AdcpDeps {
  return {
    store: v2Store,
    verifiedDelivery: liveVerifiedDelivery,
    bindings: liveBindings,
    settlement: {
      chainId: settlementDeployment.chainId,
      network: settlementDeployment.network,
      address: settlementDeployment.address,
      asset: settlementDeployment.constructor.settlementAsset,
    },
    assetSymbol: process.env.SETTLEMENT_ASSET_SYMBOL ?? "USDC",
    assetDecimals: Number(process.env.SETTLEMENT_ASSET_DECIMALS ?? 6),
    publisherDomain: process.env.V2_PUBLISHER_DOMAIN || undefined,
  };
}

/** MCP wants a content array; every tool here answers with one JSON block. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Turn a refusal into a tool error the calling agent can act on.
 *
 * `isError` matters: without it an agent reads a refusal as a successful result
 * whose body happens to mention a problem, and carries on. Sensitive-context
 * and missing-signature refusals in particular must not look like successes.
 */
function failure(error: unknown) {
  const code = error instanceof AdcpError ? error.code : "internal-error";
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }, null, 2) }],
  };
}

async function guard(run: () => unknown | Promise<unknown>) {
  try {
    return json(await run());
  } catch (error) {
    return failure(error);
  }
}

export function createAdcpMcpServer(deps: AdcpDeps = createDefaultDeps()): McpServer {
  const server = new McpServer(
    { name: "adreceipt-adcp", version: "1.0.0" },
    {
      instructions:
        "AdReceipt is an AdCP seller for one product: a disclosed sponsored recommendation inside an AI answer, settled onchain on Ethereum Sepolia. Call get_adcp_capabilities first - it states the conformance boundary and the Chainlink proof level (CRE_SIMULATED). create_media_buy always returns input-required: the advertiser wallet must sign the campaign revision before anything serves.",
    },
  );

  server.registerTool(
    "get_adcp_capabilities",
    {
      title: "Get AdCP capabilities",
      description: `Report the AdCP version (${ADCP_VERSION}), the supported tools, the settlement chain, the honest proof level, and the parts of AdCP this seller does not implement. Call this before anything else.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guard(() => getAdcpCapabilities(deps)),
  );

  server.registerTool(
    "get_products",
    {
      title: "Get products",
      description:
        "List the sponsored recommendation inventory AdReceipt can actually render and settle. Returns an empty list with a reason when publisher bindings or campaign storage are unavailable.",
      inputSchema: {
        brief: z
          .string()
          .max(2000)
          .optional()
          .describe("Natural-language description of the campaign."),
        buying_mode: z
          .string()
          .optional()
          .describe("AdCP buying mode. Only direct buying is supported."),
        promoted_offering: z
          .string()
          .max(500)
          .optional()
          .describe("What the advertiser is promoting."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => getProducts(deps, args)),
  );

  server.registerTool(
    "create_media_buy",
    {
      title: "Create media buy",
      description:
        "Create an AdReceipt campaign draft from an AdCP media buy. Always returns status input-required: the draft does not serve until the advertiser wallet signs the exact campaign revision returned here. This call cannot activate a campaign.",
      inputSchema: {
        idempotency_key: z.string().min(1).describe("Caller-supplied key for this buy."),
        buyer_ref: z.string().optional(),
        brand: z
          .object({ name: z.string().optional(), url: z.string().optional() })
          .passthrough()
          .optional()
          .describe("AdCP brand card. `name` becomes the disclosed brand, `url` the landing page."),
        start_time: z.string().describe("ISO-8601 timestamp or unix seconds."),
        end_time: z.string().describe("ISO-8601 timestamp or unix seconds."),
        total_budget: z
          .object({
            amount: z.union([z.string(), z.number()]).optional(),
            currency: z.string().optional(),
          })
          .passthrough()
          .optional(),
        packages: z
          .array(z.object({ products: z.array(z.string()) }).passthrough())
          .describe("Exactly one package referencing the AdReceipt product id."),
        ext: z
          .object({
            adreceipt: z
              .object({
                advertiser_wallet: z.string().describe("The wallet that must sign the campaign."),
                product_ref: z.string().describe("What is being advertised, verbatim."),
                landing_page: z
                  .string()
                  .optional()
                  .describe("https URL, no credentials or fragment."),
                max_placement_amount: z.union([z.string(), z.number()]).optional(),
                max_placement_amount_atomic: z.string().optional(),
                total_budget_atomic: z.string().optional(),
                creative: z
                  .object({ headline: z.string(), body: z.string() })
                  .describe("Rendered verbatim and hashed into the placement ticket."),
                targeting: z
                  .object({
                    topics: z.array(z.string()),
                    intents: z.array(z.string()),
                    locales: z.array(z.string()),
                    blocked_context_classes: z.array(z.string()),
                  })
                  .describe("Use the vocabularies from get_products.ext.adreceipt."),
              })
              .passthrough(),
          })
          .passthrough()
          .describe("AdReceipt fields AdCP does not model."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guard(() => createMediaBuy(deps, args)),
  );

  server.registerTool(
    "get_media_buy_delivery",
    {
      title: "Get media buy delivery",
      description:
        "Report lifetime delivery for one or more campaigns. Impressions and clicks are application-observed. Spend is reported only when The Graph and Sepolia RPC agree on the receipts; otherwise the row is reporting_delayed and spend is omitted.",
      inputSchema: {
        media_buy_ids: z.array(z.string()).min(1).max(25).describe("bytes32 campaign ids."),
        start_date: z.string().optional().describe("Ignored: reporting is lifetime-to-date."),
        end_date: z.string().optional().describe("Ignored: reporting is lifetime-to-date."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => getMediaBuyDelivery(deps, args)),
  );

  return server;
}
