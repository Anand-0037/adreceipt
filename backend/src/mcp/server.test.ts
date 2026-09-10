import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAdcpMcpServer } from "./server";
import { ADCP_TOOLS, PRODUCT_ID, type AdcpDeps, type PlacementBindings } from "./adcp";
import { buildCampaign, type CampaignInput, type CampaignRecord } from "../v2/campaign";

/**
 * The adapter as an MCP client actually sees it.
 *
 * The unit tests in adcp.test.ts call the handlers directly, which proves the
 * logic but not the protocol: a tool can be perfectly correct and still be
 * unreachable because it was never registered, or because its input schema
 * rejects the arguments the description tells an agent to send. These tests
 * drive a real MCP `Client` over an in-memory transport, so tool discovery,
 * argument validation, and the error channel are all exercised the way a
 * third-party agent would exercise them.
 */

const SETTLEMENT = {
  chainId: 11155111,
  network: "sepolia",
  address: "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576",
  asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

const BINDINGS: PlacementBindings = {
  publisher: "0x9999999999999999999999999999999999999999",
  payer: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
  recipient: "0x5555555555555555555555555555555555555555",
};

const CAMPAIGN_ID = `0x${"a1".repeat(32)}`;

const BUY = {
  idempotency_key: "buy-1",
  brand: { name: "DeployCo", url: "https://deployco.example/pricing" },
  start_time: "2026-01-01T00:00:00Z",
  end_time: "2026-02-01T00:00:00Z",
  total_budget: { amount: "25.00", currency: "USDC" },
  packages: [{ products: [PRODUCT_ID] }],
  ext: {
    adreceipt: {
      advertiser_wallet: "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
      product_ref: "DeployCo managed Postgres",
      max_placement_amount: "0.5",
      creative: {
        headline: "DeployCo managed Postgres",
        body: "Managed Postgres with daily backups and a free tier.",
      },
      targeting: {
        topics: ["DEVELOPER_TOOLS"],
        intents: ["COMPARE_OPTIONS"],
        locales: ["en"],
        blocked_context_classes: ["HEALTH"],
      },
    },
  },
};

function stubDeps(overrides: Partial<AdcpDeps> = {}): AdcpDeps {
  let created: CampaignRecord | null = null;
  return {
    store: {
      configured: () => true,
      async createCampaign(input: CampaignInput) {
        created = buildCampaign(input, CAMPAIGN_ID, 1);
        return created;
      },
      async getCampaign() {
        return created;
      },
      async campaignMetrics(campaignId: string) {
        return {
          campaignId,
          verifiedPlacements: 1,
          spendAtomic: "0",
          impressions: 12,
          clicks: 2,
          ctrPercent: "16.67",
          effectiveCpcAtomic: null,
          effectiveCpmAtomic: null,
        };
      },
    },
    async verifiedDelivery() {
      return { status: "VERIFIED", spendAtomic: "500000", verifiedReceipts: 1 };
    },
    bindings: () => BINDINGS,
    settlement: SETTLEMENT,
    assetSymbol: "USDC",
    assetDecimals: 6,
    now: () => 1_767_312_000,
    ...overrides,
  };
}

/** A connected client and server pair sharing one linked in-memory transport. */
async function connect(deps: AdcpDeps = stubDeps()) {
  const server = createAdcpMcpServer(deps);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  assert.equal(content[0].type, "text");
  return JSON.parse(content[0].text);
}

test("an MCP client can discover all four AdCP tools", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [...ADCP_TOOLS].sort());
    for (const tool of tools) {
      assert.ok(
        tool.description && tool.description.length > 30,
        `${tool.name} needs a description`,
      );
      assert.equal(tool.inputSchema.type, "object", `${tool.name} needs an object input schema`);
    }
  } finally {
    await close();
  }
});

test("an MCP client can call all four tools end to end", async () => {
  const { client, close } = await connect();
  try {
    const capabilities = payload(
      await client.callTool({ name: "get_adcp_capabilities", arguments: {} }),
    );
    assert.deepEqual(capabilities.tools, [...ADCP_TOOLS]);
    assert.equal(
      (capabilities.proof as Record<string, string>).policy_proof_level,
      "CRE_SIMULATED",
    );

    const products = payload(
      await client.callTool({ name: "get_products", arguments: { brief: "developer tooling" } }),
    );
    assert.equal((products.products as unknown[]).length, 1);

    const draft = payload(await client.callTool({ name: "create_media_buy", arguments: BUY }));
    assert.equal(draft.status, "input-required");
    assert.equal(draft.media_buy_id, CAMPAIGN_ID);

    const delivery = payload(
      await client.callTool({
        name: "get_media_buy_delivery",
        arguments: { media_buy_ids: [CAMPAIGN_ID] },
      }),
    );
    const rows = delivery.media_buy_deliveries as Record<string, Record<string, unknown>>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].totals.spend, "0.5");
    assert.equal(rows[0].totals.impressions, 12);
  } finally {
    await close();
  }
});

test("the create_media_buy schema documents what an agent must send", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    const create = tools.find((tool) => tool.name === "create_media_buy");
    assert.ok(create);
    const properties = create.inputSchema.properties as Record<string, unknown>;

    // An agent reads this schema instead of our source, so the AdReceipt-only
    // fields have to be discoverable there.
    for (const field of ["idempotency_key", "start_time", "end_time", "packages", "ext"]) {
      assert.ok(field in properties, `create_media_buy schema is missing ${field}`);
    }
    assert.match(create.description ?? "", /input-required/i);
    assert.match(create.description ?? "", /cannot activate/i);
  } finally {
    await close();
  }
});

test("a refusal reaches the client as a tool error, not a successful result", async () => {
  // If a refusal came back as a normal result, an agent would treat "we could
  // not sell you this" as "you bought it".
  const { client, close } = await connect(stubDeps({ bindings: () => null }));
  try {
    const result = (await client.callTool({ name: "create_media_buy", arguments: BUY })) as {
      isError?: boolean;
    };
    assert.equal(result.isError, true);
    assert.equal(payload(result).error, "inventory-unavailable");
  } finally {
    await close();
  }
});

test("unverified payment stays unreported through the protocol boundary", async () => {
  const { client, close } = await connect(
    stubDeps({
      async verifiedDelivery() {
        return { status: "UNAVAILABLE", reason: "Subgraph unreachable" };
      },
    }),
  );
  try {
    await client.callTool({ name: "create_media_buy", arguments: BUY });
    const delivery = payload(
      await client.callTool({
        name: "get_media_buy_delivery",
        arguments: { media_buy_ids: [CAMPAIGN_ID] },
      }),
    );
    const [row] = delivery.media_buy_deliveries as Record<string, Record<string, unknown>>[];
    assert.equal(row.status, "reporting_delayed");
    assert.equal("spend" in row.totals, false);
    assert.equal(delivery.partial_data, true);
  } finally {
    await close();
  }
});

test("the server rejects arguments that violate a tool's schema", async () => {
  const { client, close } = await connect();
  try {
    // media_buy_ids is required, so this must fail at the protocol layer rather
    // than reach the handler and produce a confusing empty report.
    const result = (await client.callTool({
      name: "get_media_buy_delivery",
      arguments: {},
    })) as { isError?: boolean };
    assert.equal(result.isError, true);
  } finally {
    await close();
  }
});
