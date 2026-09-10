import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router, type Request, type Response } from "express";
import { createAdcpMcpServer } from "./server";
import type { AdcpDeps } from "./adcp";

/**
 * The AdCP adapter over Streamable HTTP, mounted on the existing API.
 *
 * Agents that cannot spawn a subprocess reach the same four tools at POST /mcp.
 * Each request gets its own server and transport, and both are closed when the
 * response ends: a stateless server needs no session table, and a per-request
 * lifetime means one client's failure cannot leave state behind for the next.
 *
 * `sessionIdGenerator: undefined` is what selects that stateless mode. GET and
 * DELETE are answered explicitly rather than left to fall through to a 404,
 * because a client probing for a server-initiated stream should be told the
 * mode is unsupported instead of being told the endpoint does not exist.
 */
export function mcpRoutes(deps?: AdcpDeps): Router {
  const router = Router();

  router.post("/mcp", async (req: Request, res: Response) => {
    const server = createAdcpMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal MCP transport error",
          },
          id: null,
        });
      }
    }
  });

  const streamUnsupported = (_req: Request, res: Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "This MCP endpoint is stateless. Use POST /mcp." },
      id: null,
    });

  router.get("/mcp", streamUnsupported);
  router.delete("/mcp", streamUnsupported);

  return router;
}
