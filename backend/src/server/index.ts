import express from "express";
import { config, settlementDeployment } from "../config";
import { errorHandler } from "./errors";
import { routes } from "./routes";
import { v2Routes } from "../v2/routes";
import { mcpRoutes } from "../mcp/http";

export function createServer() {
  const app = express();

  app.use(express.json({ limit: "64kb" }));
  app.disable("x-powered-by");
  // Render terminates TLS one hop in front of this process. Trust exactly that
  // hop so domain-specific throttles see the client address rather than every
  // visitor sharing the proxy address.
  app.set("trust proxy", 1);

  // Receipt evidence is public and read-only. The sole write endpoint records
  // a positive domain proof after a one-time wallet authorization.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // The MCP transport sends its protocol version and session id as headers,
    // and browser-based agents cannot reach /mcp unless they are allowed here.
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  app.use(routes);
  app.use(v2Routes);
  // The AdCP adapter. Same services as the REST routes above, reached over MCP.
  app.use(mcpRoutes());
  app.use((_req, res) => res.status(404).json({ error: "not-found" }));
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createServer();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `AdReceipt backend listening on :${config.port}`,
        `  network    ${config.network} (${config.chainId})`,
        `  settlement ${settlementDeployment.address}`,
        `  mode       receipt reads and signed domain attestations`,
      ].join("\n"),
    );
  });
}
