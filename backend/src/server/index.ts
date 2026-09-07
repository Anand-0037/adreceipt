import express from "express";
import { config, settlementDeployment } from "../config";
import { errorHandler } from "./errors";
import { routes } from "./routes";

export function createServer() {
  const app = express();

  app.use(express.json({ limit: "64kb" }));
  app.disable("x-powered-by");

  // V1 exposes read-only public evidence. Transaction submission stays in the
  // operator-controlled Privy scripts and never crosses this HTTP boundary.
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
        `AdReceipt backend listening on :${config.port}`,
        `  network    ${config.network} (${config.chainId})`,
        `  settlement ${settlementDeployment.address}`,
        `  mode       read-only receipt verification`,
      ].join("\n"),
    );
  });
}
