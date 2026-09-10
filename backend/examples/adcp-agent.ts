import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

/**
 * A minimal external agent, start to finish.
 *
 *   npm --prefix backend run mcp:example
 *
 * This is the smallest thing that can honestly be called an AdCP buyer against
 * AdReceipt: connect, discover, read the boundary, look at the inventory, draft
 * a buy, and read delivery back. It launches the seller over stdio, which is
 * how an MCP client normally runs a local server; point `StreamableHTTPClient
 * Transport` at `POST /mcp` instead to reach a deployed one.
 *
 * Two things this example deliberately does NOT do, because AdReceipt does not
 * let it:
 *
 *   - It cannot activate the campaign. `create_media_buy` returns
 *     `input-required` and the typed data the advertiser's wallet must sign.
 *     Signing happens in the advertiser's own wallet, never here, and the
 *     signature goes to the REST approval endpoint the response names.
 *
 *   - It cannot conclude that anything was paid for. `spend` appears in
 *     delivery only when The Graph and Sepolia RPC agree on the receipts; when
 *     they cannot be reconciled the row reads `reporting_delayed` and carries
 *     no spend at all. An agent that treats a missing `spend` as zero is
 *     reading it wrong.
 */

const PRODUCT_ID = "adreceipt-sponsored-recommendation";

function show(label: string, result: unknown): Record<string, unknown> {
  const content = (result as { content?: { text: string }[]; isError?: boolean }) ?? {};
  const body = JSON.parse(content.content?.[0]?.text ?? "{}");
  console.log(`\n── ${label}${content.isError ? "  (refused)" : ""}`);
  console.log(JSON.stringify(body, null, 2).split("\n").slice(0, 40).join("\n"));
  return body;
}

async function main(): Promise<void> {
  const client = new Client({ name: "adcp-example-agent", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["ts-node", resolve(__dirname, "../src/mcp/stdio.ts")],
      cwd: resolve(__dirname, ".."),
    }),
  );

  const { tools } = await client.listTools();
  console.log(`── tools: ${tools.map((tool) => tool.name).join(", ")}`);

  // Always first: it states the proof level and what this seller will not do.
  const capabilities = show(
    "get_adcp_capabilities",
    await client.callTool({ name: "get_adcp_capabilities", arguments: {} }),
  );

  const products = show(
    "get_products",
    await client.callTool({
      name: "get_products",
      arguments: { brief: "Managed Postgres for small engineering teams" },
    }),
  );

  if (!(products.products as unknown[])?.length) {
    console.log(
      `\nNo inventory is available, so there is nothing to buy: ${products.reason}\n` +
        "Configure V2_PUBLISHER_ADDRESS, V2_PAYER_ADDRESS, V2_RECIPIENT_ADDRESS and DATABASE_URL, then run this again.",
    );
    await client.close();
    return;
  }

  const start = new Date(Date.now() + 60_000);
  const end = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const draft = show(
    "create_media_buy",
    await client.callTool({
      name: "create_media_buy",
      arguments: {
        idempotency_key: `example-${Date.now()}`,
        brand: { name: "DeployCo", url: "https://deployco.example/pricing" },
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        total_budget: { amount: "25.00", currency: "USDC" },
        packages: [{ products: [PRODUCT_ID] }],
        ext: {
          adreceipt: {
            advertiser_wallet:
              process.env.EXAMPLE_ADVERTISER_WALLET ?? "0x84B5711b5Ff458478A2E55bb4797F5b254517a57",
            product_ref: "DeployCo managed Postgres",
            max_placement_amount: "0.5",
            creative: {
              headline: "DeployCo managed Postgres",
              body: "Managed Postgres with daily backups and a free tier for small teams.",
            },
            targeting: {
              topics: ["DEVELOPER_TOOLS", "CLOUD_INFRASTRUCTURE"],
              intents: ["COMPARE_OPTIONS", "DISCOVER_TOOL"],
              locales: ["en"],
              blocked_context_classes: ["HEALTH", "POLITICS", "MINORS"],
            },
          },
        },
      },
    }),
  );

  console.log(
    [
      "",
      "── the buy is NOT live",
      `   status          ${draft.status}`,
      `   required signer ${(draft.activation as Record<string, string>)?.required_signer}`,
      `   sign this hash  ${(draft.activation as Record<string, string>)?.campaign_revision_hash}`,
      `   then POST to    ${(draft.activation as Record<string, string>)?.submit_signature_to}`,
      "",
      `   proof level     ${(capabilities.proof as Record<string, string>)?.policy_proof_level}`,
    ].join("\n"),
  );

  show(
    "get_media_buy_delivery",
    await client.callTool({
      name: "get_media_buy_delivery",
      arguments: { media_buy_ids: [draft.media_buy_id] },
    }),
  );

  await client.close();
}

main().catch((error) => {
  console.error(`example agent failed: ${error?.message ?? error}`);
  process.exit(1);
});
