import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAdcpMcpServer } from "./server";

/**
 * Run the AdCP adapter over stdio.
 *
 *   npm --prefix backend run mcp
 *
 * This is the transport an MCP client launches as a subprocess, so stdout is
 * the protocol channel and must carry nothing but JSON-RPC frames. Anything
 * this process wants to say to a human goes to stderr; a stray `console.log`
 * here corrupts the stream and the client disconnects with a parse error.
 */
async function main(): Promise<void> {
  const server = createAdcpMcpServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write("adreceipt-adcp MCP server ready on stdio\n");
}

main().catch((error) => {
  process.stderr.write(`adreceipt-adcp failed to start: ${error?.message ?? error}\n`);
  process.exit(1);
});
