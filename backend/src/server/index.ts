import express from "express";
import { config, contracts } from "../config";
import { hasSimulator } from "../chain/provider";
import { errorHandler } from "./errors";
import { routes } from "./routes";

export function createServer() {
  const app = express();

  app.use(express.json({ limit: "64kb" }));
  app.disable("x-powered-by");

  // The registry is a public good; anything here is readable on-chain anyway.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  app.use(routes);
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
        `disclosed backend listening on :${config.port}`,
        `  network    ${config.network} (${config.chainId})`,
        `  registry   ${contracts.AdvertiserRegistry}`,
        `  receiver   ${contracts.CREAttestationReceiver}`,
        `  attestation key ${hasSimulator() ? "configured" : "MISSING - reads only"}`,
      ].join("\n"),
    );
  });
}
